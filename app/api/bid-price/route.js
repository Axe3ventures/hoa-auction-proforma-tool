import { NextResponse } from "next/server";
import { writeBidPrice, resolveSheetNameForDeal } from "../../../lib/googleSheets";

// Syncs the Purchase/Bid Price typed in the app's The Numbers section into
// column AF (Price Paid) on the sheet. Price 0/empty clears the cell. This
// only writes the price — purchaser, date, and row color are untouched, so a
// synced bid price never reclassifies a row as purchased on its own.
export async function POST(request) {
  const { id, dealType, price, sheetRow } = await request.json();
  if (!id || !dealType || price === undefined || price === null) {
    return NextResponse.json({ ok: false, error: "id, dealType, and price are required" }, { status: 400 });
  }
  try {
    const sheetName = await resolveSheetNameForDeal(dealType);
    const wrote = await writeBidPrice(sheetName, String(id), price > 0 ? price : "", sheetRow);
    if (!wrote) {
      return NextResponse.json(
        { ok: false, error: "Could not write to Google Sheets — check Editor access and that the row still exists." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/bid-price failed for ${dealType}/${id}:`, err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
