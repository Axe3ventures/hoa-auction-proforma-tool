// Shared logic for classifying who purchased a property, so the write path
// (setting row color) and the read path (routing rows to the Purchased vs.
// Purchased by Other tab) can't drift out of sync with each other.

// Blank, or the literal button label "I Purchased", both mean "you" bought it
// — anything else typed into the Purchased By field is someone else's name.
export function isSelfPurchase(purchaser) {
  const p = (purchaser || "").trim().toLowerCase();
  return p === "" || p === "i purchased";
}

// The row color takes precedence over recorded purchase data: the app's own
// write path always sets both together (so they agree), which means a color
// that DISAGREES with the recorded purchaser is a deliberate manual override
// in the sheet — e.g. repainting a row green to reclaim a deal that earlier
// had another buyer's name recorded.
//
// A price ALONE (column AF) is not evidence of a purchase — the app's
// Purchase/Bid Price field syncs the working bid number into AF, so active
// rows routinely carry a price. The price fallback only classifies when an
// explicit purchaser name accompanies it (and the row color is unreadable).
export function classifySale(purchasePrice, purchaser, rowColor) {
  if (rowColor === "green") return "self";
  if (rowColor === "orange") return "other";
  if (purchasePrice > 0 && (purchaser || "").trim() !== "") {
    return isSelfPurchase(purchaser) ? "self" : "other";
  }
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
