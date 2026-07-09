import { NextResponse } from "next/server";
import { writeLockedScenario } from "../../../lib/googleSheets";
import { sheetNameFor } from "../../../lib/sheetConfig";

export async function POST(request) {
  const { id, dealType, scenario } = await request.json();
  if (!id || !dealType || !scenario) {
    return NextResponse.json({ ok: false, error: "id, dealType, and scenario are required" }, { status: 400 });
  }
  try {
    const sheetName = sheetNameFor(dealType);
    const wrote = await writeLockedScenario(sheetName, String(id), scenario);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/locked-scenario failed for ${dealType}/${id}:`, err.message);
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
    const wrote = await writeLockedScenario(sheetName, id, null);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`DELETE /api/locked-scenario failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
