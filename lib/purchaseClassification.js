// Shared logic for classifying who purchased a property, so the write path
// (setting row color) and the read path (routing rows to the Purchased vs.
// Purchased by Other tab) can't drift out of sync with each other.

// Blank, or the literal button label "I Purchased", both mean "you" bought it
// — anything else typed into the Purchased By field is someone else's name.
export function isSelfPurchase(purchaser) {
  const p = (purchaser || "").trim().toLowerCase();
  return p === "" || p === "i purchased";
}

// Prefers the recorded price/purchaser (the app's own write) over a manual
// row color, but falls back to the manual color when no price is recorded —
// mirrors how the original green-only logic treated a hand-painted row.
export function classifySale(purchasePrice, purchaser, rowColor) {
  if (purchasePrice > 0) return isSelfPurchase(purchaser) ? "self" : "other";
  if (rowColor === "green") return "self";
  if (rowColor === "orange") return "other";
  return "none";
}

// Follow-up reminder for "purchased by other" deals: a set number of days
// after the purchase date (see DEAL_CONFIG[sourceType].followUpDays), so
// there's a nudge to check whether it's back on the market.
export function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
