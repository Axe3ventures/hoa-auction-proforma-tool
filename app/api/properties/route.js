import { NextResponse } from "next/server";
import { fetchSheetRows, fetchRowColors, fetchPurchaseInfo } from "../../../lib/googleSheets";
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
  const s = String(v).trim();
  const m = s.match(/(\d[\d,]*\.?\d*)\s*([km])?/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n)) return 0;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") n *= 1000;
  if (suffix === "m") n *= 1000000;
  return n;
}

// Some sheets use the cleaned header names (from "Auction Sheet - Google
// Sheets Ready.xlsx"), others still use the original raw spreadsheet's header
// text — a live sheet the user uploaded directly, for instance. Each
// canonical field checks both.
const HEADER_ALIASES = {
  Judgment: ["Judgment", "Jgmt"],
  Mortgage_Balance: ["Mortgage_Balance", "Loan"],
  Redfin_Value: ["Redfin_Value", "Redfin"],
  Zillow_Value: ["Zillow_Value", "Zillow"],
  Caliber_Value: ["Caliber_Value", "Caliber"],
  Marc_Notes: ["Marc_Notes", "Marc"],
  Loan_Type: ["Loan_Type", "Type"],
  Plaintiff_HOA: ["Plaintiff_HOA", "Plantiff/HOA"],
  Case_Number: ["Case_Number", "Case #"],
  Auction_Date: ["Auction_Date", "Auction Date"],
  Addl_Loan_Date: ["Addl_Loan_Date", "Addl Loan"],
};

function field(r, canonical) {
  for (const alias of HEADER_ALIASES[canonical] || [canonical]) {
    if (r[alias] !== undefined && r[alias] !== "") return r[alias];
  }
  return undefined;
}

// HUD_Amount, Lien_Type, Drive_By_Notes, and Deal_Notes have no header label
// at all on an uncleaned raw sheet — only findable by position, immediately
// after wherever the Addl Loan column actually is (itself found by name, so
// this still works if extra columns like a manually-inserted "Purchased"
// shift everything over). Column layout: Addl Loan, HUD raw (+1), Lien Type
// (+2), a blank spacer (+3), Drive-By Notes (+4), Deal Notes (+5).
function resolveNotesFields(r) {
  if (r.HUD_Amount !== undefined || !r.__header) {
    return {
      hudAmount: r.HUD_Amount,
      hudNotesRaw: r.HUD_Notes_Raw,
      lienType: r.Lien_Type,
      driveByNotes: r.Drive_By_Notes,
      dealNotes: r.Deal_Notes,
    };
  }
  const addlLoanIdx = r.__header.findIndex((h) => HEADER_ALIASES.Addl_Loan_Date.includes(h));
  if (addlLoanIdx === -1) return {};
  // On a raw (uncleaned) sheet there's just one column doing double duty as
  // both the numeric HUD amount and its free-text description.
  const hudRaw = r.__raw[addlLoanIdx + 1];
  return {
    hudAmount: hudRaw,
    hudNotesRaw: hudRaw,
    lienType: r.__raw[addlLoanIdx + 2],
    driveByNotes: r.__raw[addlLoanIdx + 4],
    dealNotes: r.__raw[addlLoanIdx + 5],
  };
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

function resolveMortgage(r, notes) {
  const originalMortgage = toNum(field(r, "Mortgage_Balance"));
  const addlAmount = toNum(notes.hudAmount);
  const classification = classifyAddlLoan(field(r, "Loan_Type"), notes.lienType, notes.hudNotesRaw);

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

// `colors` is from fetchRowColors and `purchaseInfo` is from fetchPurchaseInfo
// (columns AB/AC), both aligned 1:1 with `rows` (all exclude the header row) —
// null when they couldn't be read (no Sheets connection, or local-sample
// fallback, neither of which have real color/purchase data).
function normalize(rows, sourceType, colors, purchaseInfo, localEntries) {
  return rows
    .filter((r) => r.ID)
    .map((r, i) => {
      const notes = resolveNotesFields(r);
      const { mortgageBalance, hudAmount, mortgageModified } = resolveMortgage(r, notes);
      const rowColor = colors?.[i] || "none";
      const sheetPurchase = purchaseInfo?.[i];
      const localEntry = localEntries?.find((e) => e.id === String(r.ID) && e.dealType === sourceType);
      const purchasePrice = toNum(sheetPurchase?.price) || toNum(localEntry?.price);
      const purchaser = sheetPurchase?.purchaser || localEntry?.purchaser || "";
      return {
        id: String(r.ID),
        sourceType,
        rowColor,
        // Purchased once a sale price has actually been recorded (columns
        // AD/AE on the sheet, matched by row ID), or the row was manually
        // highlighted green in the Sheet.
        purchased: purchasePrice > 0 || rowColor === "green",
        purchasePrice,
        purchaser,
        address: r.Address || "",
        city: r.City || "",
        zip: r.Zip || "",
        bed: r.Bed || "",
        bath: r.Bath || "",
        sqft: toNum(r.SqFt),
        judgment: toNum(field(r, "Judgment")),
        mortgageBalance,
        hudAmount,
        mortgageModified,
        hudNotes: notes.hudNotesRaw || "",
        lienType: notes.lienType || "",
        redfin: toNum(field(r, "Redfin_Value")),
        zillow: toNum(field(r, "Zillow_Value")),
        caliber: toNum(field(r, "Caliber_Value")),
        plaintiff: field(r, "Plaintiff_HOA") || "",
        auctionDate: field(r, "Auction_Date") || "",
        owner: r.Owner || "",
        caseNumber: field(r, "Case_Number") || "",
        loanNotes: field(r, "Marc_Notes") || "",
        driveByNotes: notes.driveByNotes || "",
        dealNotes: notes.dealNotes || "",
      };
    });
}

async function loadSourceProperties(sourceKey) {
  const config = DEAL_TYPES[sourceKey];
  const localEntries = listPurchased();
  try {
    const rows = await fetchSheetRows(config.range);
    if (rows) {
      const sheetName = sheetNameFor(sourceKey);
      const [colors, purchaseInfo] = await Promise.all([
        fetchRowColors(sheetName).catch((err) => {
          console.error(`Failed to read row colors for type=${sourceKey}:`, err.message);
          return null;
        }),
        fetchPurchaseInfo(sheetName).catch((err) => {
          console.error(`Failed to read purchase info for type=${sourceKey}:`, err.message);
          return null;
        }),
      ]);
      return { source: "google-sheets", properties: normalize(rows, sourceKey, colors, purchaseInfo, localEntries) };
    }
  } catch (err) {
    console.error(`Google Sheets fetch failed for type=${sourceKey}, using local sample data:`, err.message);
  }
  return { source: "local-sample", properties: normalize(config.fallback, sourceKey, null, null, localEntries) };
}

// A row highlighted red in the Sheet is a dead deal — drop it everywhere,
// including the Purchased tab, regardless of its purchased status.
const notEliminated = (p) => p.rowColor !== "red";

export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type") || "sheriff";

  if (type === "purchased") {
    const [sheriffData, ntsData] = await Promise.all([
      loadSourceProperties("sheriff"),
      loadSourceProperties("nts"),
    ]);
    const properties = [...sheriffData.properties, ...ntsData.properties]
      .filter(notEliminated)
      .filter((p) => p.purchased);
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
    .filter((p) => isWithinAuctionWindow(p.auctionDate) && !p.purchased);
  return NextResponse.json({ source, properties: visible });
}
