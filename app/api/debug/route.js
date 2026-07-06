import { NextResponse } from "next/server";
import { diagnoseSheet } from "../../../lib/googleSheets";
import { sheetNameFor } from "../../../lib/sheetConfig";

// Visit /api/debug?type=sheriff (or nts) to self-diagnose the Google Sheets
// connection: credentials, tab existence, ID/Purchased column detection,
// sample row background colors (raw values + how they're classified), and a
// real Editor-access test (a harmless no-op write). No secrets are returned.
export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type") || "sheriff";
  const sheetName = sheetNameFor(type);
  const result = await diagnoseSheet(sheetName);
  return NextResponse.json(result);
}
