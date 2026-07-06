import { NextResponse } from "next/server";
import { fetchSheetRows, fetchRowColors } from "../../../lib/googleSheets";
import { listPurchased } from "../../../lib/purchasedStore";
import { SHEET_RANGES, sheetNameFor } from "../../../lib/sheetConfig";
import sheriffFallbackRows from "../../../data/auction-sample.json";

// NTS (Notice of Trustee Sale / Trustee Sale) deals live on a separate "NTS" tab
// in the same Google Sheet. Until that tab exists, both deal types fall back to
// the same sample rows so the page is testable end to end.
const DEAL_TYPES = {
  sheriff: {
    range: SHEET_RANGES.sheriff,
    fallback: sheriffFallbackRows,
  },
  nts: {
    range: SHEET_RANGES.nts,
    fallback: sheriffFallbackRows,
  },
};

const AUCTION_WINDOW_MONTHS = 3;

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function normalizeLienLabel(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, "");
}

// A loan program label "matches" the original mortgage's program if they're the
// same family (VA/VA, FHA/FHA, or Conventional/CON/Con) — signals a modification
// of the existing mortgage rather than a distinct new lien.
function sameLoanProgram(lienLabel, loanTypeLabel) {
  if (!lienLabel || !loanTypeLabel) return false;
  if (lienLabel === loanTypeLabel) return true;
  const conventionalAliases = ["con", "conventional"];
  if (conventionalAliases.includes(lienLabel) && conventionalAliases.includes(loanTypeLabel)) return true;
  return lienLabel.startsWith(loanTypeLabel) || loanTypeLabel.startsWith(lienLabel);
}

// The "Addl Loan" column in the source spreadsheet is overloaded: sometimes it's
// a genuine HUD subordinate lien (e.g. an FHA "partial claim") that has to be paid
// off IN ADDITION to the primary mortgage, and sometimes it's actually a loan
// modification of that same mortgage (a new, newer balance that REPLACES the
// original figure). We tell them apart using the Lien_Type column:
//   - mentions "HUD" anywhere -> genuine subordinate lien -> ADD to the mortgage
//   - matches the original loan's program (VA/FHA/Conventional) -> loan
//     modification of the same mortgage -> REPLACES the mortgage balance
//   - anything else present (private lender, unrecognized) -> treat as a distinct
//     junior lien -> ADD to the mortgage
function classifyAddlLoan(loanType, lienType, hudNotesRaw) {
  const lien = normalizeLienLabel(lienType);
  const notes = (hudNotesRaw || "").toLowerCase();
  const loan = normalizeLienLabel(loanType);

  if (lien.includes("hud") || notes.includes("hud")) return "additive";
  if (lien && sameLoanProgram(lien, loan)) return "modification";
  if (lien) return "additive";
  return "none";
}

function resolveMortgage(r) {
  const originalMortgage = toNum(r.Mortgage_Balance);
  const addlAmount = toNum(r.HUD_Amount);
  const classification = classifyAddlLoan(r.Loan_Type, r.Lien_Type, r.HUD_Notes_Raw);

  if (classification === "modification" && addlAmount) {
    // The addl loan is a newer modification of the same mortgage — it becomes
    // the effective (newest-by-date) mortgage balance, not an add-on.
    return { mortgageBalance: addlAmount, hudAmount: 0, mortgageModified: true };
  }
  if (classification === "additive" && addlAmount) {
    return { mortgageBalance: originalMortgage, hudAmount: addlAmount, mortgageModified: false };
  }
  return { mortgageBalance: originalMortgage, hudAmount: 0, mortgageModified: false };
}

// Only show auctions within +/- 3 months of today — keeps the list focused on
// deals that are actually actionable right now. Rows with an unparseable or
// missing auction date are kept (fail-open) rather than silently hidden.
// Purchased homes skip this filter entirely — they're kept indefinitely.
function isWithinAuctionWindow(auctionDateStr) {
  if (!auctionDateStr) return true;
  const d = new Date(auctionDateStr);
  if (isNaN(d.getTime())) return true;

  const now = new Date();
  const start = new Date(now);
  start.setMonth(start.getMonth() - AUCTION_WINDOW_MONTHS);
  const end = new Date(now);
  end.setMonth(end.getMonth() + AUCTION_WINDOW_MONTHS);

  return d >= start && d <= end;
}

// `colors` is the array from fetchRowColors, aligned 1:1 with `rows` (both
// exclude the header row) — null when colors couldn't be read (no Sheets
// connection, or a local-sample fallback, which has no color data at all).
function normalize(rows, sourceType, colors) {
  return rows
    .filter((r) => r.ID)
    .map((r, i) => {
      const { mortgageBalance, hudAmount, mortgageModified } = resolveMortgage(r);
      const rowColor = colors?.[i] || "none";
      return {
        id: String(r.ID),
        sourceType,
        rowColor,
        // "Purchased" column on the sheet itself, when present, OR the row
        // manually highlighted green — either is a durable signal once Google
        // Sheets write access is configured; the local file registry (below)
        // is only a fallback for sample data.
        purchased: (r.Purchased || "").toString().trim().toLowerCase() === "true" || rowColor === "green",
        address: r.Address || "",
        city: r.City || "",
        zip: r.Zip || "",
        bed: r.Bed || "",
        bath: r.Bath || "",
        sqft: toNum(r.SqFt),
        judgment: toNum(r.Judgment),
        mortgageBalance,
        hudAmount,
        mortgageModified,
        hudNotes: r.HUD_Notes_Raw || "",
        lienType: r.Lien_Type || "",
        redfin: toNum(r.Redfin_Value),
        zillow: toNum(r.Zillow_Value),
        caliber: toNum(r.Caliber_Value),
        plaintiff: r.Plaintiff_HOA || "",
        auctionDate: r.Auction_Date || "",
        owner: r.Owner || "",
        caseNumber: r.Case_Number || "",
        loanNotes: r.Marc_Notes || "",
        driveByNotes: r.Drive_By_Notes || "",
        dealNotes: r.Deal_Notes || "",
      };
    });
}

async function loadSourceProperties(sourceKey) {
  const config = DEAL_TYPES[sourceKey];
  try {
    const rows = await fetchSheetRows(config.range);
    if (rows) {
      const colors = await fetchRowColors(sheetNameFor(sourceKey)).catch((err) => {
        console.error(`Failed to read row colors for type=${sourceKey}:`, err.message);
        return null;
      });
      return { source: "google-sheets", properties: normalize(rows, sourceKey, colors) };
    }
  } catch (err) {
    console.error(`Google Sheets fetch failed for type=${sourceKey}, using local sample data:`, err.message);
  }
  return { source: "local-sample", properties: normalize(config.fallback, sourceKey, null) };
}

// A row highlighted red in the Sheet is a dead deal — drop it everywhere,
// including the Purchased tab, regardless of its Purchased/green status.
const notEliminated = (p) => p.rowColor !== "red";

export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type") || "sheriff";
  const purchasedEntries = listPurchased();
  const isPurchased = (p) =>
    p.purchased || purchasedEntries.some((e) => e.id === p.id && e.dealType === p.sourceType);

  if (type === "purchased") {
    const [sheriffData, ntsData] = await Promise.all([
      loadSourceProperties("sheriff"),
      loadSourceProperties("nts"),
    ]);
    const properties = [...sheriffData.properties, ...ntsData.properties]
      .filter(notEliminated)
      .filter(isPurchased);
    const source =
      sheriffData.source === "google-sheets" || ntsData.source === "google-sheets"
        ? "google-sheets"
        : "local-sample";
    return NextResponse.json({ source, properties });
  }

  const sourceKey = type === "nts" ? "nts" : "sheriff";
  const { source, properties } = await loadSourceProperties(sourceKey);
  const visible = properties
    .filter(notEliminated)
    .filter((p) => isWithinAuctionWindow(p.auctionDate) && !isPurchased(p));
  return NextResponse.json({ source, properties: visible });
}
