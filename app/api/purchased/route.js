import { NextResponse } from "next/server";
import { listPurchased, markPurchased, unmarkPurchased } from "../../../lib/purchasedStore";
import { writePurchasedFlag, setRowColor } from "../../../lib/googleSheets";
import { sheetNameFor } from "../../../lib/sheetConfig";

export async function GET() {
  return NextResponse.json({ purchased: listPurchased() });
}

async function setPurchasedFlag(id, dealType, purchased) {
  const sheetName = sheetNameFor(dealType);
  const wroteToSheet = await writePurchasedFlag(sheetName, id, purchased).catch((err) => {
    console.error(`Failed to write Purchased flag to Google Sheets for ${dealType}/${id}:`, err.message);
    return false;
  });

  if (wroteToSheet) {
    // Highlight the row green to match the checkbox, or clear it back to
    // white on uncheck — otherwise a leftover green highlight would make the
    // row look purchased again the next time colors are read.
    await setRowColor(sheetName, id, purchased ? "green" : "none").catch((err) => {
      console.error(`Failed to set row color for ${dealType}/${id}:`, err.message);
    });
  }

  // The local file is the source of truth only for sample data (no Google
  // Sheets write access configured, or the sheet has no "Purchased" column
  // yet). If the sheet write succeeded, clear any stale local entry so the
  // two stores can't disagree.
  if (wroteToSheet) {
    unmarkPurchased(id, dealType);
  } else if (purchased) {
    markPurchased(id, dealType);
  } else {
    unmarkPurchased(id, dealType);
  }

  return wroteToSheet;
}

export async function POST(request) {
  const { id, dealType } = await request.json();
  if (!id || !dealType) {
    return NextResponse.json({ error: "id and dealType are required" }, { status: 400 });
  }
  try {
    const wroteToSheet = await setPurchasedFlag(String(id), dealType, true);
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
    const wroteToSheet = await setPurchasedFlag(id, dealType, false);
    return NextResponse.json({ ok: true, persistedTo: wroteToSheet ? "google-sheets" : "local" });
  } catch (err) {
    console.error(`DELETE /api/purchased failed for ${dealType}/${id}:`, err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
