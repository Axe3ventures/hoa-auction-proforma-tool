import { NextResponse } from "next/server";
import { writeFinalSalePrice, resolveSheetNameForDeal } from "../../../lib/googleSheets";

export async function POST(request) {
  const { id, dealType, finalSalePrice, sheetRow } = await request.json();
  if (!id || !dealType || !finalSalePrice) {
    return NextResponse.json({ error: "id, dealType, and finalSalePrice are required" }, { status: 400 });
  }
  try {
    const sheetName = await resolveSheetNameForDeal(dealType);
    const wrote = await writeFinalSalePrice(sheetName, String(id), finalSalePrice, sheetRow);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/final-sale-price failed for ${dealType}/${id}:`, err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
