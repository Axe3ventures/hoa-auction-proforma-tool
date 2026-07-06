import { google } from "googleapis";

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
    ranges: [`${sheetName}!A2:A1000`],
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
  if (!auth) {
    console.warn("writePurchasedFlag: no Google credentials configured (neither OAuth nor service account)");
    return false;
  }
  if (!GOOGLE_SHEET_ID) {
    console.warn("writePurchasedFlag: GOOGLE_SHEET_ID not set");
    return false;
  }

  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${sheetName}!A1:Z1000`,
  });
  const values = res.data.values || [];
  if (values.length < 2) {
    console.warn(`writePurchasedFlag: sheet "${sheetName}" has no data rows`);
    return false;
  }

  const [header, ...rows] = values;
  const idColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "id");
  const purchasedColIndex = header.findIndex((h) => (h || "").trim().toLowerCase() === "purchased");
  if (idColIndex === -1) {
    console.warn(`writePurchasedFlag: no "ID" column found on sheet "${sheetName}"`);
    return false;
  }
  if (purchasedColIndex === -1) {
    console.warn(`writePurchasedFlag: no "Purchased" column found on sheet "${sheetName}" — add one to enable write-back`);
    return false;
  }

  const rowIndex = rows.findIndex((row) => String(row[idColIndex]) === String(id));
  if (rowIndex === -1) {
    console.warn(`writePurchasedFlag: no row with ID "${id}" found on sheet "${sheetName}"`);
    return false;
  }

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

  try {
    const valuesRes = await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${sheetName}!A1:Z5`,
    });
    const values = valuesRes.data.values || [];
    result.headerRow = values[0] || [];
    result.idColIndex = result.headerRow.findIndex((h) => (h || "").trim().toLowerCase() === "id");
    result.purchasedColIndex = result.headerRow.findIndex((h) => (h || "").trim().toLowerCase() === "purchased");
  } catch (err) {
    result.valuesError = err.message;
  }

  try {
    const colorRes = await sheets.spreadsheets.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      ranges: [`${sheetName}!A2:A11`],
      fields:
        "sheets.data.rowData.values.effectiveFormat.backgroundColor,sheets.data.rowData.values.effectiveFormat.backgroundColorStyle,sheets.data.rowData.values.userEnteredFormat.backgroundColor",
    });
    const rowData = colorRes.data.sheets?.[0]?.data?.[0]?.rowData || [];
    result.sampleRowColors = rowData.map((row, i) => {
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

  result.editorAccessTest = await testEditorAccess();

  return result;
}
