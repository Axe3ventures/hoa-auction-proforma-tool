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
