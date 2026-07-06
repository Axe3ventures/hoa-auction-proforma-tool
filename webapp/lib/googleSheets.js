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
