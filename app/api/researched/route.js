import { NextResponse } from "next/server";
import { writeResearched, resolveSheetNameForDeal } from "../../../lib/googleSheets";

// Toggles the Fully Researched flag (column AK) for a property — drives the
// 👍 badge on the property list. Persisted in the sheet so it survives
// refreshes and shows on every device.
export async function POST(request) {
  const { id, dealType, researched } = await request.json();
  if (!id || !dealType || researched === undefined) {
    return NextResponse.json({ ok: false, error: "id, dealType, and researched are required" }, { status: 400 });
  }
  try {
    const sheetName = await resolveSheetNameForDeal(dealType);
    const wrote = await writeResearched(sheetName, String(id), !!researched);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/researched failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
