import { fetchSheetRows, fetchRowColors, fetchPurchaseInfo, resolveSheetNameForDeal } from "./googleSheets";
import { classifySale } from "./purchaseClassification";
import { cellRangeFor } from "./sheetConfig";
import { listAllPropertyFolders, markFolderRedSince, clearFolderRedSince, deleteFolderAndContents } from "./googleDrive";

const CLEANUP_AFTER_DAYS = 7;

function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

// Minimal per-row status (just enough to decide eligibility) rather than the
// full property normalize() does for the UI — red (manually eliminated) or
// purchased-by-other both mean "this deal isn't happening for us," so their
// photos are no longer worth keeping around.
async function getEliminationStatus(sourceKey) {
  const statusById = new Map();
  const sheetName = await resolveSheetNameForDeal(sourceKey);
  const rows = await fetchSheetRows(`${sheetName}!${cellRangeFor(sourceKey)}`);
  if (!rows) return statusById;

  const [colors, purchaseInfo] = await Promise.all([
    fetchRowColors(sheetName).catch(() => null),
    fetchPurchaseInfo(sheetName).catch(() => null),
  ]);

  rows
    .filter((r) => r.ID)
    .forEach((r, i) => {
      const rowColor = colors?.[i] || "none";
      const sheetPurchase = purchaseInfo?.[i];
      const purchasePrice = toNum(sheetPurchase?.price);
      const purchaser = sheetPurchase?.purchaser || "";
      const saleClass = classifySale(purchasePrice, purchaser, rowColor);
      statusById.set(String(r.ID), {
        eligible: rowColor === "red" || saleClass === "other",
        purchasedDate: sheetPurchase?.purchasedDate || "",
        isPurchasedByOther: saleClass === "other",
      });
    });
  return statusById;
}

// Runs the actual sweep: for every property photo folder, checks whether its
// property is currently red or purchased-by-other, and deletes the folder
// (and its photos) once it's been that way for CLEANUP_AFTER_DAYS.
//
// There's no "date turned red" anywhere in the Sheet (a manual highlight has
// no timestamp), so for red rows the 7-day clock starts the first time this
// job *notices* the row is red (recorded on the folder itself via Drive
// appProperties) — for purchased-by-other, the real purchasedDate from the
// Sheet is used directly since that's an actual event date.
export async function runPhotoCleanup() {
  const results = { checked: 0, deleted: [], clockStarted: [], errors: [] };

  const [sheriffStatus, ntsStatus] = await Promise.all([
    getEliminationStatus("sheriff").catch((err) => {
      results.errors.push(`sheriff lookup failed: ${err.message}`);
      return new Map();
    }),
    getEliminationStatus("nts").catch((err) => {
      results.errors.push(`nts lookup failed: ${err.message}`);
      return new Map();
    }),
  ]);

  const folders = await listAllPropertyFolders();
  const now = Date.now();

  for (const folder of folders) {
    results.checked++;
    if (!folder.dealType || !folder.propertyId) continue; // shouldn't happen, but skip anything untagged
    const statusMap = folder.dealType === "nts" ? ntsStatus : sheriffStatus;
    const status = statusMap.get(folder.propertyId);

    if (!status || !status.eligible) {
      // Back to normal (or the row/ID vanished) — clear any stale marker so a
      // *future* elimination restarts the 7-day clock instead of reusing an
      // old date.
      if (folder.redSince) {
        await clearFolderRedSince(folder.id).catch((err) => results.errors.push(`${folder.name}: ${err.message}`));
      }
      continue;
    }

    const anchor =
      status.isPurchasedByOther && status.purchasedDate ? new Date(status.purchasedDate).getTime() : null;

    if (anchor) {
      if ((now - anchor) / 86400000 >= CLEANUP_AFTER_DAYS) {
        await deleteFolderAndContents(folder.id)
          .then(() => results.deleted.push(folder.name))
          .catch((err) => results.errors.push(`${folder.name}: ${err.message}`));
      }
      continue;
    }

    // Red, with no natural date — use (or start) the observed-since marker.
    if (folder.redSince) {
      if ((now - new Date(folder.redSince).getTime()) / 86400000 >= CLEANUP_AFTER_DAYS) {
        await deleteFolderAndContents(folder.id)
          .then(() => results.deleted.push(folder.name))
          .catch((err) => results.errors.push(`${folder.name}: ${err.message}`));
      }
    } else {
      await markFolderRedSince(folder.id, new Date().toISOString().slice(0, 10))
        .then(() => results.clockStarted.push(folder.name))
        .catch((err) => results.errors.push(`${folder.name}: ${err.message}`));
    }
  }

  return results;
}
