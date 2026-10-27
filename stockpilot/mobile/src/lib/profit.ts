/** Same maths as the backend's insights.profit_calc. */
export function profitCalc(price: number, cost: number, shipping: number, feePct: number, feeFixed: number, ads: number) {
  const fees = (price * feePct) / 100 + feeFixed;
  const beforeAds = price - cost - shipping - fees;
  const profit = beforeAds - ads;
  const keep = 1 - feePct / 100 - 0.3;
  return {
    fees,
    profit,
    marginPct: price ? (profit / price) * 100 : 0,
    maxAdCost: Math.max(0, beforeAds),
    breakEvenRoas: beforeAds > 0 ? price / beforeAds : null,
    priceFor30: keep > 0 ? (cost + shipping + feeFixed + ads) / keep : null,
  };
}
