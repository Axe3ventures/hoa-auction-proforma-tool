// Mirrors the formulas in "TEST of ProForma2026.xlsx" (per-property tabs, e.g. "Mercury"):
// Total Cost = Purchase Price + Remodel Cost
// Gross Proceeds = Sale Price - Broker Commission - Routine Closing Costs - Seller Paid Closing Costs
// Total Profit = Gross Proceeds - Total Cost
// Investor/Company Profit = Total Profit split by investorSplitPct
// ROI = Profit / Total Cost; Annualized ROI = ROI * (365 / cycleDays)

export function computeDeal({
  purchasePrice,
  remodelCost,
  salePrice,
  sellerClosingCost,
  brokerCommissionPct = 0.05,
  routineClosingPct = 0.01,
  investorSplitPct = 0.5,
  cycleDays = 180,
}) {
  const totalCost = purchasePrice + remodelCost;
  const brokerCommission = salePrice * brokerCommissionPct;
  const routineClosingCosts = salePrice * routineClosingPct;
  const grossProceeds = salePrice - brokerCommission - routineClosingCosts - sellerClosingCost;
  const totalProfit = grossProceeds - totalCost;
  const investorProfit = totalProfit * investorSplitPct;
  const companyProfit = totalProfit - investorProfit;

  const totalROI = totalCost !== 0 ? totalProfit / totalCost : 0;
  const investorROI = totalCost !== 0 ? investorProfit / totalCost : 0;
  const companyROI = totalCost !== 0 ? companyProfit / totalCost : 0;

  const annualizeFactor = cycleDays > 0 ? 365 / cycleDays : 0;

  return {
    totalCost,
    brokerCommission,
    routineClosingCosts,
    grossProceeds,
    totalProfit,
    investorProfit,
    companyProfit,
    totalROI,
    investorROI,
    companyROI,
    annualizedTotalROI: totalROI * annualizeFactor,
    annualizedInvestorROI: investorROI * annualizeFactor,
    annualizedCompanyROI: companyROI * annualizeFactor,
  };
}

// Solves computeDeal's totalROI = targetROI for purchasePrice, holding
// remodelCost/salePrice/sellerClosingCost fixed. Since totalCost = purchasePrice + remodelCost
// and totalROI = (grossProceeds - totalCost) / totalCost, rearranging gives:
//   totalCost = grossProceeds / (1 + targetROI)
//   maxBid = totalCost - remodelCost
export function computeMaxBid({
  remodelCost,
  salePrice,
  sellerClosingCost,
  targetROI,
  brokerCommissionPct = 0.05,
  routineClosingPct = 0.01,
}) {
  const brokerCommission = salePrice * brokerCommissionPct;
  const routineClosingCosts = salePrice * routineClosingPct;
  const grossProceeds = salePrice - brokerCommission - routineClosingCosts - sellerClosingCost;
  const maxTotalCost = grossProceeds / (1 + targetROI);
  return maxTotalCost - remodelCost;
}
