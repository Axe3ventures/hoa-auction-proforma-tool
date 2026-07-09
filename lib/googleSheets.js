import { google } from "googleapis";
import { sheetNameFor, SHEET_NAME_CANDIDATES } from "./sheetConfig";

// Two supported auth modes, tried in this order:
//  1. OAuth (your own Google account) — set GOOGLE_OAUTH_CLIENT_ID/SECRET/
//     REFRESH_TOKEN (see /api/oauth/start for the one-time setup flow). No
//     sharing step needed — you already have access to your own sheets.
//     The refresh token was issued with the full "spreadsheets" scope, so it
//     covers both reads and writes regardless of the `scopes` argument.
//  2. Service account JSON key — set GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY,
//     and share the sheet with that email as Editor.
function getAuth(scopes) {
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN,
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
  } = process.env;

  if (GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN) {
    const oauth2Client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
    oauth2Client.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
    return oauth2Client;
  }

  if (GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY) {
    return new google.auth.JWT(GOOGLE_SERVICE_ACCOUNT_EMAIL, null, GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), scopes);
  }

  return null;
}

// Lists the spreadsheet's actual tab titles, cached briefly so resolving a tab
// name doesn't add a metadata round-trip to every read/write. Returns null if
// Sheets isn't configured or the metadata call fails (callers then fall back to
// the configured name verbatim).
let _tabTitleCache = { at: 0, titles: null };
const TAB_TITLE_TTL_MS = 60_000;

async function listTabTitles() {
  const now = Date.now();
  if (_tabTitleCache.titles && now - _tabTitleCache.at < TAB_TITLE_TTL_MS) {
    return _tabTitleCache.titles;
  }
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!auth || !process.env.GOOGLE_SHEET_ID) return null;
  try {
    const sheets = google.sheets({ version: "v4", auth });
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      fields: "sheets.properties.title",
    });
    const titles = (meta.data.sheets || []).map((s) => s.properties.title);
    _tabTitleCache = { at: now, titles };
    return titles;
  } catch (err) {
    console.error("listTabTitles failed:", err.message);
    return null;
  }
}

const normalizeTabName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Pure matcher (no I/O, exported for testing): picks, from the real tab
// `titles`, the one that best matches the preferred name or one of its
// aliases. Tries exact normalized match on the preferred name and each alias
// first, then a substring match in either direction (so "Sheriff" finds
// "Sheriff Sale" and vice versa). Returns the preferred name unchanged when
// `titles` is empty or nothing matches — so behavior is identical to before
// whenever the configured name is already correct.
export function pickTabName(titles, preferredName, candidates = []) {
  if (!titles || titles.length === 0) return preferredName;

  const wanted = [preferredName, ...candidates].filter(Boolean);

  for (const w of wanted) {
    const nw = normalizeTabName(w);
    const exact = titles.find((t) => normalizeTabName(t) === nw);
    if (exact) return exact;
  }
  for (const w of wanted) {
    const nw = normalizeTabName(w);
    if (!nw) continue;
    const partial = titles.find((t) => {
      const nt = normalizeTabName(t);
      return nt.includes(nw) || nw.includes(nt);
    });
    if (partial) return partial;
  }
  return preferredName;
}

// Resolves a configured/preferred tab name to the tab that actually exists in
// the spreadsheet, tolerating harmless renames (e.g. "Sheriff" vs "Sheriff
// Sale"). Falls back to the preferred name when metadata is unavailable.
export async function resolveSheetName(preferredName, candidates = []) {
  const titles = await listTabTitles();
  return pickTabName(titles, preferredName, candidates);
}

// Convenience wrapper: resolve the real tab name for a deal type using its
// configured (env-derived) name plus the known aliases for that deal type.
export async function resolveSheetNameForDeal(dealType) {
  return resolveSheetName(sheetNameFor(dealType), SHEET_NAME_CANDIDATES[dealType] || []);
}

// Returns null (triggering the local sample-data fallback) if Google credentials
// aren't configured yet, so the app is usable before Google Cloud setup is finished.
//
// Each returned row is zipped by header name (trimmed; blank/duplicate headers
// keep the first occurrence), plus non-enumerable `__raw` (the raw cell array)
// and `__header` (the trimmed header array) for positional lookups — some
// sheets (e.g. an uncleaned original upload) have several trailing columns
// with no header label at all, which can only be found by position.
export async function fetchSheetRows(range) {
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!auth || !process.env.GOOGLE_SHEET_ID) return null;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range,
  });

  const values = res.data.values || [];
  if (values.length < 2) return [];

  const [rawHeader, ...rows] = values;
  const header = rawHeader.map((h) => (h || "").toString().trim());

  return rows.map((row) => {
    const obj = {};
    header.forEach((h, i) => {
      if (h && obj[h] === undefined) obj[h] = row[i];
    });
    Object.defineProperty(obj, "__raw", { value: row, enumerable: false });
    Object.defineProperty(obj, "__header", { value: header, enumerable: false });
    return obj;
  });
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h;
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h * 60, s, l };
}

// Classifies a cell's background color as "red", "orange", "green", or "none"
// (blank/white/gray/blue/yellow/etc), by hue rather than raw channel
// comparison — a channel-dominance check misclassifies yellow (high red,
// high green) as red. Works across the whole Sheets highlight palette (light
// red 1-3, light orange 1-3, light green 1-3, pure red/green/orange, ...).
//
// Google's API omits a channel from the JSON entirely when it's exactly 0
// (proto3's default-value omission) — e.g. pure red comes back as `{red: 1}`
// with green/blue absent, NOT full white. Missing channels must default to 0,
// not 1, or every pure red/green/blue collapses into white.
function classifyColor(bg) {
  if (!bg) return "none";
  const r = bg.red ?? 0;
  const g = bg.green ?? 0;
  const b = bg.blue ?? 0;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.12 || l > 0.95 || l < 0.05) return "none"; // grayscale / white / near-black
  if (h >= 340 || h < 20) return "red";
  if (h >= 20 && h < 50) return "orange";
  if (h >= 80 && h < 170) return "green";
  return "none";
}

// Reads the background color of column A for each data row (row 2 onward) on
// a sheet tab, so rows highlighted red/green in the Sheet can drive filtering
// — red rows get eliminated from the list entirely, green rows are treated as
// already purchased. Returns null if Sheets isn't configured, or an array of
// "red"/"green"/"none" aligned with the data rows.
//
// Uses `effectiveFormat`, not `userEnteredFormat` — userEnteredFormat only
// reflects colors applied directly (paint-bucket fill), not colors computed
// by a Conditional Formatting rule. effectiveFormat is the actual rendered
// color either way. The conditional formatting range must include column A
// for a "highlight the whole row" rule to be picked up here.
export async function fetchRowColors(sheetName) {
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!auth || !process.env.GOOGLE_SHEET_ID) return null;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    ranges: [`${sheetName}!A2:A3000`],
    fields:
      "sheets.data.rowData.values.effectiveFormat.backgroundColor,sheets.data.rowData.values.effectiveFormat.backgroundColorStyle",
  });

  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return rowData.map((row) => {
    const fmt = row?.values?.[0]?.effectiveFormat;
    return classifyColor(fmt?.backgroundColorStyle?.rgbColor || fmt?.backgroundColor);
  });
}

const HIGHLIGHT_COLORS = {
  green: { red: 0.714, green: 0.843, blue: 0.659 }, // Google Sheets "light green 2"
  orange: { red: 0.965, green: 0.698, blue: 0.42 }, // Google Sheets "light orange 2"
  none: { red: 1, green: 1, blue: 1 },
};

// Sets (or clears) the whole row's background color on the sheet, matching by
// ID column — mirrors the Purchased / Purchased by Other status in the app
// onto the sheet's own row-highlighting convention. Returns false if write
// access isn't configured.
export async function setRowColor(sheetName, id, colorName) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });

  const [meta, valuesRes] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" }),
    sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!${HEADER_SCAN_RANGE}` }),
  ]);

  const sheetId = meta.data.sheets?.find((s) => s.properties.title === sheetName)?.properties?.sheetId;
  const values = valuesRes.data.values || [];
  if (sheetId === undefined || values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const gridRowIndex = rowIndex + 1; // +1 because the header occupies grid row 0
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: gridRowIndex,
              endRowIndex: gridRowIndex + 1,
              startColumnIndex: 0,
              endColumnIndex: header.length,
            },
            cell: { userEnteredFormat: { backgroundColor: HIGHLIGHT_COLORS[colorName] || HIGHLIGHT_COLORS.none } },
            fields: "userEnteredFormat.backgroundColor",
          },
        },
      ],
    },
  });
  return true;
}

// Purchaser name, sale price, purchase date, and follow-up reminder date live
// at these FIXED columns on every sheet tab, independent of header text —
// deliberately not looked up by header name (unlike the ID column) so this
// doesn't depend on any particular header label existing at all.
// Confirmed empty across every real data row on both the Sheriff Sale and NTS
// tabs before use (AD held a handful of stray legacy notes on Sheriff Sale).
const PURCHASER_COL = "AE";
const PRICE_COL = "AF";
const DATE_COL = "AG";
const FOLLOWUP_COL = "AH";
// The actual resale/flip price, recorded independently and later than the
// auction purchase itself (once the deal actually closes) — separate from
// PRICE_COL, which is what was paid to acquire it at auction.
const FINAL_SALE_COL = "AI";
// Drive-By Notes — already the de facto position for this on Sheriff Sale's
// raw (uncleaned) layout (4 columns after "Addl Loan"); given a real header
// label here too so it's readable by name on both tabs (see HEADER_ALIASES
// in app/api/properties/route.js) instead of position-guessing.
const DRIVE_BY_NOTE_COL = "AA";
// A JSON blob of the locked Sliding Scale scenario (purchase price, remodel
// cost, sale price, etc.) — persisted so "Lock Numbers" actually survives a
// refresh instead of just being in-memory React state. Empty means unlocked.
const LOCK_COL = "AJ";

// Column header row can put "ID" (or the purchaser/price/date columns)
// anywhere — e.g. the NTS tab's ID column lives at AD, well past column Z —
// so lookups that need the full header row must read out this far rather
// than assuming ID is within A:Z.
const HEADER_SCAN_RANGE = `A1:${LOCK_COL}3000`;

// 1-indexed column number for a letter reference (AF -> 32), so we can check
// it against a tab's actual gridProperties.columnCount before reading/writing.
function colLetterToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Reads columns AE (purchaser), AF (price), AG (purchase date), AI (final
// sale price), and AJ (locked scenario JSON) for each data row (row 2
// onward), aligned with the data rows the same way fetchRowColors is.
// Returns null if Sheets isn't configured.
export async function fetchPurchaseInfo(sheetName) {
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!auth || !process.env.GOOGLE_SHEET_ID) return null;

  const sheets = google.sheets({ version: "v4", auth });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!${PURCHASER_COL}2:${LOCK_COL}3000`,
    });
    const rows = res.data.values || [];
    return rows.map((row) => ({
      purchaser: row[0] || "",
      price: row[1] || "",
      purchasedDate: row[2] || "",
      finalSalePrice: row[4] || "",
      lockedScenario: row[5] || "",
    }));
  } catch (err) {
    // Columns AE:AI don't exist yet on a narrower tab (grid isn't wide
    // enough) — that only happens before any purchase has ever been written
    // there, so there's genuinely no purchase data to report. Self-heals
    // once writePurchaseInfo widens the grid on the first write.
    if (err.message?.includes("exceeds grid limits")) return [];
    throw err;
  }
}

// Writes the purchaser name, sale price, purchase date, and follow-up
// reminder date into columns AE/AF/AG/AH for the row matching `id` (looked up
// by the ID column, wherever that is — e.g. column A on Sheriff Sale, column
// AD on NTS), so purchase details survive across machines/deploys instead of
// living only in a local file. Pass empty strings to clear all four (undoing
// a purchase). Returns false (caller should fall back to local storage) if
// write access isn't configured — this requires the account to have Editor
// access to the sheet, not just Viewer.
export async function writePurchaseInfo(sheetName, id, { purchaser, price, purchasedDate, followUpDate }) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth) {
    console.warn("writePurchaseInfo: no Google credentials configured (neither OAuth nor service account)");
    return false;
  }
  if (!GOOGLE_SHEET_ID) {
    console.warn("writePurchaseInfo: GOOGLE_SHEET_ID not set");
    return false;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${HEADER_SCAN_RANGE}`,
  });
  const values = res.data.values || [];
  if (values.length < 2) {
    console.warn(`writePurchaseInfo: sheet "${sheetName}" has no data rows`);
    return false;
  }

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) {
    console.warn(`writePurchaseInfo: no "ID" column found on sheet "${sheetName}"`);
    return false;
  }

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) {
    console.warn(`writePurchaseInfo: no row with ID "${id}" found on sheet "${sheetName}"`);
    return false;
  }

  // Some tabs don't have columns out to AE:AH yet — widen the grid first, or
  // the write below fails with "exceeds grid limits" instead of landing.
  const requiredCols = colLetterToIndex(FOLLOWUP_COL);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
  const sheetProps = meta.data.sheets?.find((s) => s.properties.title === sheetName)?.properties;
  const currentCols = sheetProps?.gridProperties?.columnCount || 0;
  if (sheetProps && currentCols < requiredCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          { appendDimension: { sheetId: sheetProps.sheetId, dimension: "COLUMNS", length: requiredCols - currentCols } },
        ],
      },
    });
  }

  const sheetRow = rowIndex + 2; // +1 for the header row, +1 for 1-indexing
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${sheetName}!${PURCHASER_COL}${sheetRow}`, values: [[purchaser || ""]] },
        { range: `${sheetName}!${PRICE_COL}${sheetRow}`, values: [[price || ""]] },
        { range: `${sheetName}!${DATE_COL}${sheetRow}`, values: [[purchasedDate || ""]] },
        { range: `${sheetName}!${FOLLOWUP_COL}${sheetRow}`, values: [[followUpDate || ""]] },
      ],
    },
  });
  return true;
}

// Writes the actual final resale price into column AI, independent of
// writePurchaseInfo — this is recorded separately and later, once the flip
// actually closes, not at the moment of the auction purchase itself. Returns
// false if write access isn't configured or the row can't be found.
export async function writeFinalSalePrice(sheetName, id, finalSalePrice) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${HEADER_SCAN_RANGE}`,
  });
  const values = res.data.values || [];
  if (values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const requiredCols = colLetterToIndex(FINAL_SALE_COL);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
  const sheetProps = meta.data.sheets?.find((s) => s.properties.title === sheetName)?.properties;
  const currentCols = sheetProps?.gridProperties?.columnCount || 0;
  if (sheetProps && currentCols < requiredCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          { appendDimension: { sheetId: sheetProps.sheetId, dimension: "COLUMNS", length: requiredCols - currentCols } },
        ],
      },
    });
  }

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${FINAL_SALE_COL}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[finalSalePrice || ""]] },
  });
  return true;
}

// Writes (or clears, if `scenario` is null) the locked Sliding Scale
// snapshot into column AJ as JSON — this is what makes "Lock Numbers"
// survive a refresh or relaunch instead of resetting to computed defaults.
// Returns false if write access isn't configured or the row can't be found.
export async function writeLockedScenario(sheetName, id, scenario) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${HEADER_SCAN_RANGE}`,
  });
  const values = res.data.values || [];
  if (values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const requiredCols = colLetterToIndex(LOCK_COL);
  const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
  const sheetProps = meta.data.sheets?.find((s) => s.properties.title === sheetName)?.properties;
  const currentCols = sheetProps?.gridProperties?.columnCount || 0;
  if (sheetProps && currentCols < requiredCols) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          { appendDimension: { sheetId: sheetProps.sheetId, dimension: "COLUMNS", length: requiredCols - currentCols } },
        ],
      },
    });
  }

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${LOCK_COL}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[scenario ? JSON.stringify(scenario) : ""]] },
  });
  return true;
}

// Appends a timestamped note to column AA (Drive-By Notes) for the row
// matching `id`, preserving whatever's already there rather than overwriting
// it — manual notes already in that cell (including years of pre-existing
// entries on Sheriff Sale) are never touched, only added to. Returns false if
// write access isn't configured or the row can't be found.
export async function appendDriveByNote(sheetName, id, noteText) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${HEADER_SCAN_RANGE}`,
  });
  const values = res.data.values || [];
  if (values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const noteColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "drive by notes");
  const existing = noteColIndex !== -1 ? rows[rowIndex][noteColIndex] || "" : "";
  const combined = existing ? `${existing}\n\n${noteText}` : noteText;

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${DRIVE_BY_NOTE_COL}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[combined]] },
  });
  return true;
}

// Wipes column AA (Drive-By Notes) entirely for the row matching `id` — a
// full clear, including any pre-existing manual content that predates the
// app, not just what appendDriveByNote itself added. Returns false if write
// access isn't configured or the row can't be found.
export async function clearDriveByNotes(sheetName, id) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${HEADER_SCAN_RANGE}`,
  });
  const values = res.data.values || [];
  if (values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  if (idColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${DRIVE_BY_NOTE_COL}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[""]] },
  });
  return true;
}

// Verifies the service account actually has Editor (not just Viewer) access,
// by making a harmless no-op write (re-setting the spreadsheet's title to its
// current value) — a real write request, so it fails with a permission error
// if the account can't edit, unlike a read call which succeeds even as Viewer.
export async function testEditorAccess() {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth) return { attempted: false, reason: "no Google credentials configured (neither OAuth nor service account)" };
  if (!GOOGLE_SHEET_ID) return { attempted: false, reason: "GOOGLE_SHEET_ID not set" };

  const sheets = google.sheets({ version: "v4", auth });
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "properties.title" });
    const title = meta.data.properties?.title;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: { requests: [{ updateSpreadsheetProperties: { properties: { title }, fields: "title" } }] },
    });
    return { attempted: true, success: true };
  } catch (err) {
    return { attempted: true, success: false, error: err.message };
  }
}

// Full self-diagnosis for one sheet tab: credentials, tab existence, header
// columns, sample row colors (raw values + classification), and a real
// Editor-access test. Used by /api/debug so the actual failure mode is
// visible instead of guessed at.
export async function diagnoseSheet(sheetName) {
  const {
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REFRESH_TOKEN,
    GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_PRIVATE_KEY,
    GOOGLE_SHEET_ID,
  } = process.env;
  const hasOAuth = !!(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REFRESH_TOKEN);
  const hasServiceAccount = !!(GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_PRIVATE_KEY);
  const result = {
    sheetName,
    authMode: hasOAuth ? "oauth" : hasServiceAccount ? "service-account" : "none",
    serviceAccountEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL || null,
    hasSheetId: !!GOOGLE_SHEET_ID,
    // Per-variable presence (not values) so a single missing/misnamed var is
    // visible instead of one aggregated "no credentials" boolean.
    oauthVarsPresent: {
      GOOGLE_OAUTH_CLIENT_ID: !!GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET: !!GOOGLE_OAUTH_CLIENT_SECRET,
      GOOGLE_OAUTH_REFRESH_TOKEN: !!GOOGLE_OAUTH_REFRESH_TOKEN,
    },
  };

  const readAuth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!readAuth || !GOOGLE_SHEET_ID) {
    result.error = "Missing Google credentials (OAuth or service account) or GOOGLE_SHEET_ID env var";
    return result;
  }

  const sheets = google.sheets({ version: "v4", auth: readAuth });

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" });
    result.availableTabs = meta.data.sheets.map((s) => s.properties.title);
    result.sheetFound = result.availableTabs.includes(sheetName);
  } catch (err) {
    result.metadataError = err.message;
    return result;
  }

  if (!result.sheetFound) return result;

  let dataValues = [];
  let auctionDateColIndex = -1;
  try {
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:${FOLLOWUP_COL}3000`,
    });
    const values = valuesRes.data.values || [];
    result.headerRow = values[0] || [];
    result.idColIndex = result.headerRow.findIndex((h) => (h || "").trim().toLowerCase() === "id");
    auctionDateColIndex = result.headerRow.findIndex(
      (h) => (h || "").trim().toLowerCase().replace(/[^a-z]/g, "") === "auctiondate"
    );
    dataValues = values.slice(1); // rows 2 onward
  } catch (err) {
    result.valuesError = err.message;
  }

  let colorClasses = [];
  try {
    const colorRes = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      ranges: [`${sheetName}!A2:A3000`],
      fields:
        "sheets.data.rowData.values.effectiveFormat.backgroundColor,sheets.data.rowData.values.effectiveFormat.backgroundColorStyle,sheets.data.rowData.values.userEnteredFormat.backgroundColor",
    });
    const rowData = colorRes.data.sheets?.[0]?.data?.[0]?.rowData || [];
    colorClasses = rowData.map((row) => {
      const fmt = row?.values?.[0]?.effectiveFormat;
      const effective = fmt?.backgroundColorStyle?.rgbColor || fmt?.backgroundColor;
      return classifyColor(effective);
    });
    result.sampleRowColors = rowData.slice(0, 10).map((row, i) => {
      const fmt = row?.values?.[0]?.effectiveFormat;
      const uef = row?.values?.[0]?.userEnteredFormat;
      const effective = fmt?.backgroundColorStyle?.rgbColor || fmt?.backgroundColor;
      return {
        row: i + 2,
        effectiveBackgroundColor: effective || null,
        userEnteredBackgroundColor: uef?.backgroundColor || null,
        classification: classifyColor(effective),
      };
    });
  } catch (err) {
    result.colorError = err.message;
  }

  // Correlated per-row view: ID + auction date + color classification for every
  // data row, so it's directly visible whether e.g. upcoming (2026) auctions are
  // being hidden because their row is color-marked (red = eliminated,
  // green/orange = purchased). Plus a compact summary of color x auction-year.
  result.sampleRows = dataValues.map((row, i) => ({
    row: i + 2,
    id: result.idColIndex >= 0 ? row[result.idColIndex] : undefined,
    auctionDate: auctionDateColIndex >= 0 ? row[auctionDateColIndex] : undefined,
    color: colorClasses[i] || "none",
  }));
  const summary = {};
  let newest = null;
  let idRowCount = 0;
  for (const r of result.sampleRows) {
    if (r.id === undefined || r.id === "") continue;
    idRowCount++;
    // Parse the year via Date so both 4-digit ("6/24/2026") and 2-digit
    // ("6/24/26") years are bucketed correctly.
    const dt = new Date(r.auctionDate);
    const year = isNaN(dt.getTime()) ? "(unparsed)" : String(dt.getFullYear());
    if (!isNaN(dt.getTime()) && (!newest || dt > new Date(newest))) newest = r.auctionDate;
    summary[r.color] = summary[r.color] || {};
    summary[r.color][year] = (summary[r.color][year] || 0) + 1;
  }
  result.colorByYear = summary;
  result.idRowCount = idRowCount;
  result.newestAuctionDate = newest;
  result.auctionDateColIndex = auctionDateColIndex;

  try {
    result.samplePurchaseInfo = (await fetchPurchaseInfo(sheetName))?.slice(0, 10) || [];
  } catch (err) {
    result.purchaseInfoError = err.message;
  }

  result.editorAccessTest = await testEditorAccess();

  return result;
}
