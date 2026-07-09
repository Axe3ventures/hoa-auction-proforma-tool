// Shared Google Sheet tab config for both deal types, used by both the
// properties API route (reading) and the purchased API route (writing).
export const SHEET_RANGES = {
  sheriff: process.env.GOOGLE_SHEET_RANGE_SHERIFF || "Auction!A1:Z1000",
  nts: process.env.GOOGLE_SHEET_RANGE_NTS || "NTS!A1:Z1000",
};

export function sheetNameFor(dealType) {
  const range = SHEET_RANGES[dealType] || SHEET_RANGES.sheriff;
  return range.split("!")[0];
}

// The A1 cell portion of a deal type's range (e.g. "A1:Z1000"), independent of
// the tab name — so a resolved/renamed tab name can be recombined with it.
export function cellRangeFor(dealType) {
  const range = SHEET_RANGES[dealType] || SHEET_RANGES.sheriff;
  return range.split("!")[1] || "A1:Z1000";
}

// Known aliases a tab might be named, so a harmless rename (e.g. dragging the
// tab and relabeling "Sheriff" -> "Sheriff Sale") doesn't silently empty the
// feed. The configured/env name (sheetNameFor) is always tried first; these
// are extra fallbacks matched against the sheet's real tab titles by
// resolveSheetName in googleSheets.js.
export const SHEET_NAME_CANDIDATES = {
  sheriff: ["Sheriff Sale", "Sheriff Sales", "Sheriff", "Auction"],
  nts: ["NTS", "NTS (Trustee Sale)", "Trustee Sale"],
};
