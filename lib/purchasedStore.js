import fs from "fs";
import path from "path";

// Simple file-backed registry of purchased properties, keyed by (id, dealType).
// Purchased homes are excluded from the Sheriff Sales / NTS lists (which are
// date-windowed) and shown instead on the Purchased tab indefinitely.
const FILE_PATH = path.join(process.cwd(), "data", "purchased.json");

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(entries) {
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(entries, null, 2));
  } catch (err) {
    // Vercel's production filesystem is read-only outside /tmp — this local
    // file is only ever meant to work in local dev. Log and no-op rather than
    // let this throw and 500 the whole request.
    console.warn("purchasedStore: could not write local fallback file (expected on serverless hosts):", err.message);
  }
}

export function listPurchased() {
  return readAll();
}

export function markPurchased(id, dealType, { price, purchaser } = {}) {
  const entries = readAll().filter((e) => !(e.id === id && e.dealType === dealType));
  entries.push({ id, dealType, price: price || "", purchaser: purchaser || "", purchasedAt: new Date().toISOString() });
  writeAll(entries);
  return entries;
}

export function unmarkPurchased(id, dealType) {
  const entries = readAll().filter((e) => !(e.id === id && e.dealType === dealType));
  writeAll(entries);
  return entries;
}
