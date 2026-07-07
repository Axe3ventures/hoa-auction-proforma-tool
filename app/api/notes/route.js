import { NextResponse } from "next/server";
import { appendDriveByNote, clearDriveByNotes } from "../../../lib/googleSheets";
import { sheetNameFor } from "../../../lib/sheetConfig";

export async function POST(request) {
  const { id, dealType, note } = await request.json();
  if (!id || !dealType || !note || !note.trim()) {
    return NextResponse.json({ ok: false, error: "id, dealType, and a non-empty note are required" }, { status: 400 });
  }
  try {
    const sheetName = sheetNameFor(dealType);
    const wrote = await appendDriveByNote(sheetName, String(id), note.trim());
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/notes failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const dealType = searchParams.get("dealType");
  if (!id || !dealType) {
    return NextResponse.json({ error: "id and dealType are required" }, { status: 400 });
  }
  try {
    const sheetName = sheetNameFor(dealType);
    const wrote = await clearDriveByNotes(sheetName, id);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/notes failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
