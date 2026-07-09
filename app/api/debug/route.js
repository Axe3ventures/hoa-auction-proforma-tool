import { NextResponse } from "next/server";
import { diagnoseSheet, resolveSheetNameForDeal } from "../../../lib/googleSheets";

// Visit /api/debug?type=sheriff (or nts) to self-diagnose the Google Sheets
// connection: credentials, tab existence, ID/Purchased column detection,
// sample row background colors (raw values + how they're classified), and a
// real Editor-access test (a harmless no-op write). No secrets are returned.
export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type") || "sheriff";
  // Diagnose whatever tab the app will actually read (tolerant of a rename).
  const sheetName = await resolveSheetNameForDeal(type);
  const result = await diagnoseSheet(sheetName);
  return NextResponse.json(result);
}
