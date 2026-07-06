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
  fs.writeFileSync(FILE_PATH, JSON.stringify(entries, null, 2));
}

export function listPurchased() {
  return readAll();
}

export function isPurchased(id, dealType, entries = readAll()) {
  return entries.some((e) => e.id === id && e.dealType === dealType);
}

export function markPurchased(id, dealType) {
  const entries = readAll();
  if (!isPurchased(id, dealType, entries)) {
    entries.push({ id, dealType, purchasedAt: new Date().toISOString() });
    writeAll(entries);
  }
  return entries;
}

export function unmarkPurchased(id, dealType) {
  const entries = readAll().filter((e) => !(e.id === id && e.dealType === dealType));
  writeAll(entries);
  return entries;
}
