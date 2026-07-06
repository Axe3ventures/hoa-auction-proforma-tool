import { NextResponse } from "next/server";
import { listPurchased, markPurchased, unmarkPurchased } from "../../../lib/purchasedStore";
import { writePurchaseInfo, setRowColor } from "../../../lib/googleSheets";
import { sheetNameFor } from "../../../lib/sheetConfig";

export async function GET() {
  return NextResponse.json({ purchased: listPurchased() });
}

async function setPurchaseDetails(id, dealType, { price, purchaser }) {
  const sheetName = sheetNameFor(dealType);
  const wroteToSheet = await writePurchaseInfo(sheetName, id, { price, purchaser }).catch((err) => {
    console.error(`Failed to write purchase info to Google Sheets for ${dealType}/${id}:`, err.message);
    return false;
  });

  if (wroteToSheet) {
    // Highlight the row green to match, or clear it back to white when
    // un-purchasing — otherwise a leftover green highlight would make the row
    // look purchased again the next time colors are read.
    await setRowColor(sheetName, id, price ? "green" : "none").catch((err) => {
      console.error(`Failed to set row color for ${dealType}/${id}:`, err.message);
    });
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
  const { id, dealType, price, purchaser } = await request.json();
  if (!id || !dealType || !price) {
    return NextResponse.json({ error: "id, dealType, and price are required" }, { status: 400 });
  }
  try {
    const wroteToSheet = await setPurchaseDetails(String(id), dealType, { price, purchaser: purchaser || "" });
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
  if (!id || !dealType) {
    return NextResponse.json({ error: "id and dealType are required" }, { status: 400 });
  }
  try {
    const wroteToSheet = await setPurchaseDetails(id, dealType, { price: "", purchaser: "" });
    return NextResponse.json({ ok: true, persistedTo: wroteToSheet ? "google-sheets" : "local" });
  } catch (err) {
    console.error(`DELETE /api/purchased failed for ${dealType}/${id}:`, err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
