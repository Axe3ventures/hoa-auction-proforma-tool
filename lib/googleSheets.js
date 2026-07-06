import { google } from "googleapis";

function getAuth(scopes) {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) return null;
  return new google.auth.JWT(GOOGLE_SERVICE_ACCOUNT_EMAIL, null, GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"), scopes);
}

// Returns null (triggering the local sample-data fallback) if Google credentials
// aren't configured yet, so the app is usable before Google Cloud setup is finished.
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

  const [header, ...rows] = values;
  return rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
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

// Classifies a cell's background color as "red", "green", or "none" (blank/
// white/gray/blue/yellow/etc), by hue rather than raw channel comparison —
// a channel-dominance check misclassifies yellow (high red, high green) as
// red. Works across the whole Sheets highlight palette (light red 1-3, light
// green 1-3, pure red/green, ...).
function classifyColor(bg) {
  if (!bg) return "none";
  const r = bg.red ?? 1;
  const g = bg.green ?? 1;
  const b = bg.blue ?? 1;
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.12 || l > 0.95 || l < 0.05) return "none"; // grayscale / white / near-black
  if (h >= 340 || h < 20) return "red";
  if (h >= 80 && h < 170) return "green";
  return "none";
}

// Reads the background color of column A for each data row (row 2 onward) on
// a sheet tab, so rows the user manually highlighted red/green in the Sheet
// can drive filtering — red rows get eliminated from the list entirely, green
// rows are treated as already purchased. Returns null if Sheets isn't
// configured, or an array of "red"/"green"/"none" aligned with the data rows.
export async function fetchRowColors(sheetName) {
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  if (!auth || !process.env.GOOGLE_SHEET_ID) return null;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    ranges: [`${sheetName}!A2:A1000`],
    fields: "sheets.data.rowData.values.userEnteredFormat.backgroundColor",
  });

  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return rowData.map((row) => classifyColor(row?.values?.[0]?.userEnteredFormat?.backgroundColor));
}

const HIGHLIGHT_COLORS = {
  green: { red: 0.714, green: 0.843, blue: 0.659 }, // Google Sheets "light green 2"
  none: { red: 1, green: 1, blue: 1 },
};

// Sets (or clears) the whole row's background color on the sheet, matching by
// ID column — mirrors the "Purchased" checkbox in the app onto the sheet's own
// row-highlighting convention. Returns false if write access isn't configured.
export async function setRowColor(sheetName, id, colorName) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });

  const [meta, valuesRes] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: GOOGLE_SHEET_ID, fields: "sheets.properties" }),
    sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${sheetName}!A1:Z1000` }),
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

function colIndexToLetter(index) {
  let letter = "";
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

// Writes into a "Purchased" column on the given sheet tab, matching the row by
// its ID column, so purchased status survives across machines/deploys instead
// of living only in a local file. Returns false (caller should fall back to
// local storage) if write access isn't configured yet or the sheet has no
// "Purchased" column — this requires the service account to have Editor
// access to the sheet, not just Viewer.
export async function writePurchasedFlag(sheetName, id, purchased) {
  const { GOOGLE_SHEET_ID } = process.env;
  const auth = getAuth(["https://www.googleapis.com/auth/spreadsheets"]);
  if (!auth || !GOOGLE_SHEET_ID) return false;

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!A1:Z1000`,
  });
  const values = res.data.values || [];
  if (values.length < 2) return false;

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  const purchasedColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "purchased");
  if (idColIndex === -1 || purchasedColIndex === -1) return false;

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) return false;

  const sheetRow = rowIndex + 2; // +1 for the header row, +1 for 1-indexing
  const colLetter = colIndexToLetter(purchasedColIndex);
  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!${colLetter}${sheetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [[purchased ? "TRUE" : ""]] },
  });
  return true;
}
