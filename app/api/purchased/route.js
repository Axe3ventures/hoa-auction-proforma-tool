import { NextResponse } from "next/server";
import { listPurchased, markPurchased, unmarkPurchased } from "../../../lib/purchasedStore";
import { writePurchaseInfo, setRowColor, writeFinalSalePrice, resolveSheetNameForDeal } from "../../../lib/googleSheets";
import { isSelfPurchase, addDays } from "../../../lib/purchaseClassification";
import { DEAL_CONFIG } from "../../../lib/dealConfig";

export async function GET() {
  return NextResponse.json({ purchased: listPurchased() });
}

async function setPurchaseDetails(id, dealType, { price, purchaser }, sheetRow) {
  const sheetName = await resolveSheetNameForDeal(dealType);
  const purchasedDate = price ? new Date().toISOString().slice(0, 10) : "";
  // Written to the sheet purely for visibility (the app itself recomputes
  // this independently in /api/properties) — a follow-up nudge only applies
  // when someone else bought it, not on a self-purchase.
  const followUpDays = DEAL_CONFIG[dealType]?.followUpDays ?? 270;
  const followUpDate = price && !isSelfPurchase(purchaser) ? addDays(purchasedDate, followUpDays) : "";
  const wroteToSheet = await writePurchaseInfo(sheetName, id, { price, purchaser, purchasedDate, followUpDate }, sheetRow).catch((err) => {
    console.error(`Failed to write purchase info to Google Sheets for ${dealType}/${id}:`, err.message);
    return false;
  });

  if (wroteToSheet) {
    // Highlight the row green for a self-purchase, orange when someone else's
    // name was entered as the buyer, or clear it back to white when
    // un-purchasing — otherwise a leftover highlight would make the row look
    // purchased again the next time colors are read.
    const colorName = !price ? "none" : isSelfPurchase(purchaser) ? "green" : "orange";
    await setRowColor(sheetName, id, colorName, sheetRow).catch((err) => {
      console.error(`Failed to set row color for ${dealType}/${id}:`, err.message);
    });
    // Un-purchasing means it's back up for sale — a previously recorded final
    // sale price no longer applies, so clear it rather than leaving stale
    // data behind for the next time this row is actually sold.
    if (!price) {
      await writeFinalSalePrice(sheetName, id, "", sheetRow).catch((err) => {
        console.error(`Failed to clear final sale price for ${dealType}/${id}:`, err.message);
      });
    }
    // The sheet is now the source of truth — clear any stale local entry so
    // the two stores can't disagree.
    unmarkPurchased(id, dealType);
  } else if (price) {
    markPurchased(id, dealType, { price, purchaser });
  } else {
    unmarkPurchased(id, dealType);
  }

  return wroteToSheet;
}

export async function POST(request) {
  const { id, dealType, price, purchaser, sheetRow } = await request.json();
  if (!id || !dealType || !price) {
    return NextResponse.json({ error: "id, dealType, and price are required" }, { status: 400 });
  }
  try {
    const wroteToSheet = await setPurchaseDetails(String(id), dealType, { price, purchaser: purchaser || "" }, sheetRow);
    return NextResponse.json({ ok: true, persistedTo: wroteToSheet ? "google-sheets" : "local" });
  } catch (err) {
    console.error(`POST /api/purchased failed for ${dealType}/${id}:`, err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const dealType = searchParams.get("dealType");
  const sheetRow = searchParams.get("sheetRow");
  if (!id || !dealType) {
    return NextResponse.json({ error: "id and dealType are required" }, { status: 400 });
  }
  try {
    const wroteToSheet = await setPurchaseDetails(id, dealType, { price: "", purchaser: "" }, sheetRow);
    return NextResponse.json({ ok: true, persistedTo: wroteToSheet ? "google-sheets" : "local" });
  } catch (err) {
    console.error(`DELETE /api/purchased failed for ${dealType}/${id}:`, err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
