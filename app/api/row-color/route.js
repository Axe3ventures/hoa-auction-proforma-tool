import { NextResponse } from "next/server";
import { setRowColor, resolveSheetNameForDeal } from "../../../lib/googleSheets";

// Paints (or clears) a whole property row's background on the sheet. Drives
// the manual status buttons: Canceled → red (also drops the row from the app),
// Contact → magenta, Flyer → yellow, and "none" to clear. Purchased routing
// still uses green/orange via the purchased flow; those are allowed here too
// for completeness but the UI doesn't call them.
const ALLOWED = new Set(["red", "orange", "green", "magenta", "yellow", "none"]);

export async function POST(request) {
  const { id, dealType, color } = await request.json();
  if (!id || !dealType || !ALLOWED.has(color)) {
    return NextResponse.json(
      { ok: false, error: "id, dealType, and a valid color are required" },
      { status: 400 }
    );
  }
  try {
    const sheetName = await resolveSheetNameForDeal(dealType);
    const wrote = await setRowColor(sheetName, String(id), color);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/row-color failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
