/**
 * Profit leak finder: where the store quietly loses money, in money per month, with the fix.
 * Everything is worked out from the seller's own sales, costs, fees and stock.
 */
import { DAY, Facts, fmtMoney, fmtNum, fmtPct, perWeek, plural } from './facts';
import type { LocalProduct } from '../engine';

export type LeakKind = 'loss' | 'thin_margin' | 'price_slip' | 'stockout' | 'runs_out_early' | 'channel_gap' | 'dead_stock' | 'overstock' | 'missing_cost';

export interface Leak {
  id: string;
  kind: LeakKind;
  severity: 'high' | 'medium' | 'low';
  product_id: number | null;
  product_name: string | null;
  title: string;
  detail: string;
  fix: string;
  /** Profit lost (or that could be gained) per month. */
  monthly: number;
  /** Cash tied up in stock (dead stock and overstock). */
  cash: number;
  /** A price that fixes it, when there is one. */
  suggested_price: number | null;
}

export interface LeakReport {
  monthly_total: number;
  cash_total: number;
  count: number;
  items: Leak[];
  /** Leaks not shown on the Free plan. */
  locked_count: number;
  headline: string;
  how: string;
}

const TARGET_MARGIN = 0.25; // what a "fix" price aims for, after fees
const THIN = 0.1; // below this margin after fees, one return wipes out several sales
const HOLDING = 0.02; // a month of storage and the cash's cost, as a share of stock value at cost
const KIND_LABEL: Record<LeakKind, string> = {
  loss: 'Selling at a loss',
  thin_margin: 'Thin margin',
  price_slip: 'Price has slipped',
  stockout: 'Sold out: missed sales',
  runs_out_early: 'Will run out before new stock arrives',
  channel_gap: 'Earns less on one channel',
  dead_stock: 'Cash stuck in stock that doesn’t sell',
  overstock: 'Too much stock',
  missing_cost: 'Blind spot: no cost price',
};
export const leakLabel = (k: LeakKind) => KIND_LABEL[k];

/** The price that leaves `margin` of the price as profit after the fee rate. */
const priceFor = (cost: number, feeRate: number, margin: number) => {
  const keep = 1 - feeRate - margin;
  return keep > 0.05 ? Math.round((cost / keep) * 100) / 100 : null;
};
/** Round a price up to a typical shelf price (x.49 / x.99). */
const shelf = (v: number) => {
  const whole = Math.floor(v), frac = v - whole;
  return frac <= 0.49 ? whole + 0.49 : whole + 0.99;
};

export function findLeaks(f: Facts, freeLimit: number | null = null): LeakReport {
  const now = f.now, m = (v: number) => fmtMoney(v, f.cur), out: Leak[] = [];
  const add = (l: Omit<Leak, 'id' | 'product_name' | 'product_id'> & { product: LocalProduct }) => {
    const { product, ...rest } = l;
    out.push({ ...rest, id: `${l.kind}:${product.id}`, product_id: product.id, product_name: product.name });
  };
  const span = f.firstSale ? Math.min(90, Math.max(14, (now - f.firstSale) / DAY)) : 90;
  const from = now - span * DAY, perMonth = 30 / span, storeFee = f.storeFeeRate();
  const byProduct = f.aggBy(from, now, (s) => s.pid);
  const byProductChannel = f.aggBy(from, now, (s) => `${s.pid}|${f.channelOf(s)}`);
  const recent = f.aggBy(now - 30 * DAY, now, (s) => s.pid);
  const before = f.aggBy(now - 120 * DAY, now - 30 * DAY, (s) => s.pid);
  const missingCost: { p: LocalProduct; revenue: number }[] = [];

  for (const p of f.products) {
    const a = byProduct.get(p.id);
    const it = f.fc.get(p.id), plan = it?.stock_plan, fc = it?.forecast;
    if (a && a.units > 0) {
      const price = a.revenue / a.units, feeRate = a.revenue ? a.fees / a.revenue : storeFee;
      if (p.cost_price <= 0) {
        missingCost.push({ p, revenue: a.revenue });
      } else {
        const unit = price - a.fees / a.units - p.cost_price, margin = price ? unit / price : 0, monthlyUnits = a.units * perMonth;
        const fixPrice = priceFor(p.cost_price, feeRate, TARGET_MARGIN);
        if (unit < 0) {
          add({
            kind: 'loss', severity: 'high', product: p, monthly: -unit * monthlyUnits, cash: 0, suggested_price: fixPrice ? shelf(fixPrice) : null,
            title: `${p.name} loses ${m(-unit)} on every sale`,
            detail: `It sells for about ${m(price)}. You pay ${m(p.cost_price)}, and fees take ${m(a.fees / a.units)}. That's ${fmtNum(a.units)} sold in the last ${Math.round(span)} days, each one at a loss.`,
            fix: fixPrice ? `Raise the price to about ${m(shelf(fixPrice))} (a ${fmtPct(TARGET_MARGIN)} margin after fees), find a cheaper supplier, or stop selling it.` : 'Fees and cost are higher than any sensible price: find a cheaper supplier or stop selling it.',
          });
        } else if (margin < THIN && monthlyUnits >= 2 && fixPrice && fixPrice > price) {
          const target = shelf(priceFor(p.cost_price, feeRate, 0.2) ?? fixPrice);
          add({
            kind: 'thin_margin', severity: 'medium', product: p, monthly: Math.max(0, (target - price) * (1 - feeRate)) * monthlyUnits, cash: 0, suggested_price: target,
            title: `${p.name} only keeps ${fmtPct(margin)} of each sale`,
            detail: `You keep ${m(unit)} of a ${m(price)} sale after cost and fees. One return wipes out the profit of several sales.`,
            fix: `Try ${m(target)}. If sales hold, that's about ${m(Math.max(0, (target - price) * (1 - feeRate)) * monthlyUnits)} more profit a month.`,
          });
        }
        // Price slipped: selling for less lately than before (discounts, auto-pricing, a competitor match).
        const r = recent.get(p.id), b = before.get(p.id);
        if (r && b && r.units >= 4 && b.units >= 4) {
          const rp = r.revenue / r.units, bp = b.revenue / b.units;
          if (rp < bp * 0.92 && unit >= 0) {
            add({
              kind: 'price_slip', severity: 'medium', product: p, monthly: (bp - rp) * r.units * (1 - feeRate), cash: 0, suggested_price: Math.round(bp * 100) / 100,
              title: `${p.name} sells for ${fmtPct((bp - rp) / bp)} less than it used to`,
              detail: `Average price ${m(rp)} in the last 30 days, against ${m(bp)} in the 3 months before. ${r.units >= b.units / 3 ? "Sales didn't rise enough to make up for it." : 'Sales fell as well.'}`,
              fix: `Check for a discount, coupon or automatic price rule that's still running. Going back to ${m(bp)} on ${fmtNum(r.units)} sales a month adds about ${m((bp - rp) * r.units * (1 - feeRate))}.`,
            });
          }
        }
        // Same product, different channel: one keeps less per sale.
        const chans = f.channels().map((ch) => ({ ch, a: byProductChannel.get(`${p.id}|${ch}`) })).filter((x) => x.a && x.a.units >= 5) as { ch: string; a: NonNullable<ReturnType<typeof byProduct.get>> }[];
        if (chans.length >= 2) {
          const per = chans.map((x) => ({ ch: x.ch, units: x.a.units, unit: x.a.profit / x.a.units })).sort((x, y) => y.unit - x.unit);
          const best = per[0], worst = per[per.length - 1], gap = best.unit - worst.unit;
          if (gap >= Math.max(1, price * 0.08)) {
            const names: Record<string, string> = { ebay: 'eBay', amazon: 'Amazon', shopify: 'your website', etsy: 'Etsy', tiktok: 'TikTok Shop', other: 'other channels' };
            add({
              kind: 'channel_gap', severity: 'low', product: p, monthly: gap * worst.units * perMonth, cash: 0, suggested_price: null,
              title: `${p.name} earns ${m(gap)} less per sale on ${names[worst.ch] ?? worst.ch}`,
              detail: `You keep ${m(best.unit)} a sale on ${names[best.ch] ?? best.ch} but ${m(worst.unit)} on ${names[worst.ch] ?? worst.ch} (${fmtNum(worst.units)} sold there in ${Math.round(span)} days), because of fees or a lower price.`,
              fix: `Raise the ${names[worst.ch] ?? worst.ch} price by about ${m(gap)}, or send buyers to ${names[best.ch] ?? best.ch}.`,
            });
          }
        }
      }
    }
    if (!plan || !fc || it?.locked) continue;
    const unitProfit = a && a.units && p.cost_price > 0 ? Math.max(0, a.profit / a.units) : null;
    if (plan.status === 'out_of_stock' && fc.next_week > 0) {
      const lostUnits = fc.next_week * (30 / 7);
      add({
        kind: 'stockout', severity: 'high', product: p, monthly: unitProfit != null ? unitProfit * lostUnits : 0, cash: 0, suggested_price: null,
        title: `${p.name} is sold out: about ${perWeek(fc.next_week)} in missed sales`,
        detail: `Customers were still buying it. Each missed sale is ${unitProfit != null ? m(unitProfit) + ' of profit' : 'lost revenue'}, and a listing that stays out of stock can drop in search.`,
        fix: `Order ${fmtNum(plan.reorder_qty)} now${p.supplier ? ` from ${p.supplier}` : ''}. Until it arrives, point buyers to a similar product.`,
      });
    } else if (plan.status === 'reorder_now' && plan.stockout_in_days != null && plan.stockout_in_days < (p.lead_time_days ?? 7)) {
      const gapDays = (p.lead_time_days ?? 7) - plan.stockout_in_days, lostUnits = (fc.next_week / 7) * gapDays;
      if (lostUnits >= 1) {
        add({
          kind: 'runs_out_early', severity: 'high', product: p, monthly: unitProfit != null ? unitProfit * lostUnits : 0, cash: 0, suggested_price: null,
          title: `${p.name} runs out in ${plan.stockout_in_days} days, ${gapDays} days before new stock can arrive`,
          detail: `The supplier needs about ${p.lead_time_days} days. About ${fmtNum(lostUnits)} sales could be missed in the gap.`,
          fix: `Order ${fmtNum(plan.reorder_qty)} today and ask for faster shipping, or raise the price a little to slow sales until it arrives.`,
        });
      }
    }
  }

  // Cash stuck in stock that doesn't sell, and stock far beyond what sells.
  for (const p of f.products) {
    if (!p.stock_known || p.stock_qty <= 0 || p.cost_price <= 0) continue;
    const last = f.lastSoldAt(p.id), idle = last == null ? null : (now - last) / DAY;
    const it = f.fc.get(p.id), fc = it?.forecast;
    if (last == null || idle! >= 60) {
      const cash = p.stock_qty * p.cost_price;
      if (cash < 20) continue;
      const floor = priceFor(p.cost_price, storeFee, 0);
      add({
        kind: 'dead_stock', severity: cash >= 200 ? 'medium' : 'low', product: p, monthly: cash * HOLDING, cash, suggested_price: floor ? Math.ceil(floor * 100) / 100 : null,
        title: `${m(cash)} stuck in ${p.name}`,
        detail: `${fmtNum(p.stock_qty)} in stock and ${last == null ? 'no sales yet' : `no sales for ${Math.round(idle!)} days`}. Stock that sits costs storage and holds cash you could put into best sellers.`,
        fix: `Clear it: bundle it with a best seller, or discount it${floor ? ` (not below ${m(Math.ceil(floor * 100) / 100)}, where a sale stops covering cost and fees)` : ''}.`,
      });
    } else if (fc && fc.next_week > 0 && !it?.locked) {
      const weeks = p.stock_qty / fc.next_week;
      if (weeks > 26) {
        const excess = Math.floor(p.stock_qty - 12 * fc.next_week), cash = excess * p.cost_price;
        if (cash >= 50) {
          add({
            kind: 'overstock', severity: 'low', product: p, monthly: cash * HOLDING, cash, suggested_price: null,
            title: `${p.name}: ${fmtNum(Math.round(weeks))} weeks of stock`,
            detail: `${fmtNum(p.stock_qty)} in stock for about ${fmtNum(fc.next_week, 1)} sales a week. About ${fmtNum(excess)} units (${m(cash)} at cost) won't sell for 3 months or more.`,
            fix: "Don't reorder it for now, and use it in bundles or promotions to turn it back into cash.",
          });
        }
      }
    }
  }

  if (missingCost.length) {
    const rev = missingCost.reduce((x, r) => x + r.revenue, 0);
    out.push({
      id: 'missing_cost:store', kind: 'missing_cost', severity: 'medium', product_id: null, product_name: null, monthly: 0, cash: 0, suggested_price: null,
      title: `${plural(missingCost.length, 'product')} with no cost price`,
      detail: `They brought in ${m(rev * perMonth)} a month, but without what you pay per item we can't tell if they make or lose money. ${missingCost.slice(0, 3).map((r) => r.p.name).join(', ')}${missingCost.length > 3 ? '…' : ''}`,
      fix: 'Add the costs (Account → Stock counts & costs → Costs). It takes a minute and this check gets sharper.',
    });
  }

  // Many small slow sellers read better as one line than as dozens.
  for (const kind of ['dead_stock', 'overstock'] as const) {
    const all = out.filter((l) => l.kind === kind).sort((a, b) => b.cash - a.cash);
    const keep = kind === 'dead_stock' ? 8 : 5;
    if (all.length <= keep + 1) continue;
    const rest = all.slice(keep), cash = rest.reduce((x, l) => x + l.cash, 0);
    for (const l of rest) out.splice(out.indexOf(l), 1);
    out.push({
      id: `${kind}:rest`, kind, severity: 'low', product_id: null, product_name: null, suggested_price: null,
      monthly: rest.reduce((x, l) => x + l.monthly, 0), cash,
      title: kind === 'dead_stock' ? `${m(cash)} in ${rest.length} more slow products` : `${rest.length} more products with far more stock than sells`,
      detail: kind === 'dead_stock' ? `Smaller amounts each, but together they hold ${m(cash)}: ${rest.slice(0, 4).map((l) => l.product_name).join(', ')}…` : `About ${m(cash)} of stock that won't sell for 3 months or more: ${rest.slice(0, 4).map((l) => l.product_name).join(', ')}…`,
      fix: kind === 'dead_stock' ? 'Put them in a clearance section or a “2 for” deal, and don’t reorder them. The Stock tab lists every product with its last sale.' : 'Pause reordering them and use them in bundles.',
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => (a.kind === 'missing_cost' ? 1 : 0) - (b.kind === 'missing_cost' ? 1 : 0) || b.monthly - a.monthly || sevRank[a.severity] - sevRank[b.severity] || b.cash - a.cash);
  const monthly = out.reduce((x, l) => x + l.monthly, 0), cash = out.reduce((x, l) => x + l.cash, 0);
  const shown = freeLimit == null ? out : out.slice(0, freeLimit);
  const headline = !out.length
    ? 'No profit leaks found. Prices cover cost and fees, and stock is moving.'
    : `About ${m(monthly)} a month is slipping away${cash > 0 ? `, and ${m(cash)} is stuck in stock` : ''}. Fix the top ${Math.min(3, out.length)} first.`;
  return {
    monthly_total: monthly, cash_total: cash, count: out.length, items: shown, locked_count: out.length - shown.length, headline,
    how: `Checked ${plural(f.products.length, 'product')} against the last ${Math.round(span)} days of sales: the price each one really sold for, what you pay, and the fee each channel takes. Missed sales use the forecast. Stuck stock is costed at ${fmtPct(HOLDING)} of its value a month (storage plus the cash it holds).`,
  };
}
