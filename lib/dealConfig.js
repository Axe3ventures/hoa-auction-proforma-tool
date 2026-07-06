// Shared per-deal-type constants. The Purchased tab mixes properties originally
// sourced from both Sheriff Sales and NTS, so it looks up the right config per
// property via `sourceType` instead of using one static config for the page.
export const DEAL_CONFIG = {
  sheriff: {
    title: "Sheriff Sales",
    goalDays: 240,
    targetProfit: 50000,
    judgmentLabel: "Judgment",
  },
  nts: {
    title: "NTS (Trustee Sale)",
    goalDays: 90,
    targetProfit: 50000,
    judgmentLabel: "Opening Bid / Payoff",
  },
};
