/**
 * Tools that work without AI or a server: Product Check (margin, trends, red flags),
 * instant answers about the seller's own store, and listing drafts.
 * Every number comes from the seller's data or their own inputs, never guessed.
 */
import { money, num, orderWhen } from './format';
import { profitCalc } from './profit';
import type { Dashboard, ForecastResponse, Insights, LibraryItem, Product, TrendLibrary } from './types';

// ----------------------------------------------------------------------------- Product Check

const RED_FLAGS: [RegExp, string][] = [
  [/batter|lithium|power ?bank|rechargeable/, 'Batteries: couriers and marketplaces have extra shipping rules for lithium batteries, and suppliers should provide test reports (UN38.3).'],
  [/serum|cream|skincare|skin care|cosmetic|lotion|makeup|lipstick|shampoo|collagen|face mask|overnight mask|balm/, 'Cosmetics: ingredient labelling and safety rules apply (the FDA in the US, a responsible person in the UK and EU). Ask the supplier for the paperwork.'],
  [/baby|infant|toddler|kid|child|toy/, "Children's products need safety testing and certificates (for example CPC in the US, UKCA or CE in the UK and EU). Marketplaces often ask for them."],
  [/supplement|vitamin|gumm|probiotic|magnesium|collagen powder/, 'Supplements: strict rules on health claims, and Amazon and TikTok Shop require approval for the category.'],
  [/knife|blade|sword|pepper spray|taser/, 'Age-restricted or banned on some platforms and in some countries.'],
  [/magnet/, 'Small strong magnets are restricted in toys and products for children.'],
  [/aerosol|perfume|nail polish|liquid|flammable/, 'Liquids, aerosols and flammable items have shipping limits, especially by air.'],
  [/charger|plug|electric|heater|heated|\bled\b|lamp|mains/, 'Electrical items need the right plug and safety marks for each country (UL/FCC in the US, UKCA or CE in the UK and EU).'],
  [/\bcbd\b|hemp|vape|nicotine/, 'Banned or tightly restricted on most marketplaces and ad platforms.'],
  [/nike|adidas|apple|disney|stanley|lego|pokemon|marvel|gucci|airpods/, "Trademark risk: don't use brand names in your title or images unless you are an authorised seller."],
  [/glass|ceramic|mirror|fragile/, 'Fragile: budget for breakages and returns, and pack well.'],
  [/dress|shirt|shoe|jeans|legging|clothing|apparel|ring size/, 'Clothing and shoes have higher return rates because of sizing. Add a clear size chart.'],
  [/food|snack|treat|tea|coffee|sauce/, 'Food and pet food need labelling and sometimes registration where you sell. Check expiry dates with the supplier.'],
];

export function redFlags(idea: string): string[] {
  const t = idea.toLowerCase();
  return RED_FLAGS.filter(([re]) => re.test(t)).map(([, text]) => text);
}

/** Products in the trends list that share words with the idea, best match first. */
export function trendMatches(idea: string, lib: TrendLibrary | null): { item: LibraryItem; niche: string }[] {
  if (!lib) return [];
  const words = idea.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const out: { item: LibraryItem; niche: string; hits: number }[] = [];
  for (const n of lib.niches)
    for (const item of n.items) {
      const hay = `${item.name} ${item.supplier_search}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w.replace(/s$/, ''))).length;
      if (hits) out.push({ item, niche: n.name, hits });
    }
  return out.sort((a, b) => b.hits - a.hits).slice(0, 2);
}

export type Verdict = 'go' | 'test_small' | 'skip' | 'need_numbers';

export interface CheckResult {
  verdict: Verdict;
  why: string;
  calc: ReturnType<typeof profitCalc> | null;
  flags: string[];
  trends: { item: LibraryItem; niche: string }[];
  testBudget: number;
}

export function checkProduct(
  idea: string,
  inputs: { price: number; cost: number; shipping: number; ads: number; feePct: number; feeFixed: number },
  lib: TrendLibrary | null,
  cur: string,
): CheckResult {
  const flags = redFlags(idea);
  const trends = trendMatches(idea, lib);
  const { price, cost } = inputs;
  if (!price || !cost) {
    return { verdict: 'need_numbers', why: 'Type the price and what you pay per item to get a verdict on the margin.', calc: null, flags, trends, testBudget: 20 };
  }
  const calc = profitCalc(price, cost, inputs.shipping, inputs.feePct, inputs.feeFixed, inputs.ads);
  const m = Math.round(calc.marginPct * 10) / 10;
  let verdict: Verdict, why: string;
  if (m >= 25 && flags.length <= 1) {
    verdict = 'go';
    why = `You keep ${money(calc.profit, cur)} (${m}%) per sale after fees${inputs.ads ? ' and ads' : ''}.`;
  } else if (m >= 10) {
    verdict = 'test_small';
    why = `${m}% margin ${m < 25 ? 'is thin once returns and ads come in' : 'works, but check the red flags'}. Order a small batch or list it as dropship first.`;
  } else {
    verdict = 'skip';
    why = calc.profit < 0 ? `Every sale loses ${money(-calc.profit, cur)}.` : `Only ${m}% margin (${money(calc.profit, cur)} a sale): one return wipes out several sales.`;
  }
  return { verdict, why, calc, flags, trends, testBudget: Math.max(20, Math.round(calc.maxAdCost * 10)) };
}

// ----------------------------------------------------------------------------- instant answers

export interface StoreData {
  fc: ForecastResponse;
  dash: Dashboard;
  ins: Insights;
  products: Product[];
  cur: string;
}

export const STARTERS = [
  'What should I reorder this week?',
  'Which product made the most profit this month?',
  'What is not selling and how much cash is tied up in it?',
  'How did this week compare to last week?',
  'What will I sell next week?',
  'Which products sell together?',
];

export const HELP =
  'I can answer questions about reordering, profit and best sellers, slow stock, this week vs last week, next week’s forecast, fees, stock value, sales channels, products bought together, or any product by name. Try one of the suggestions.';

const list = (rows: string[]) => rows.map((r) => `• ${r}`).join('\n');
const pctWord = (v: number | null) => (v == null ? '' : ` (${v >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(v * 100))}%)`);

/** Answers a question from the seller's own numbers, or returns null if it doesn't know how. */
export function answerQuestion(q: string, d: StoreData): string | null {
  const t = q.toLowerCase();
  const m = (v: number) => money(v, d.cur);
  if (!d.products.length) return 'Import your sales first (Account → Import), then I can answer from your data.';
  const items = d.fc.items.filter((i) => !i.locked && i.stock_plan && i.forecast);

  if (/reorder|restock|order more|run(ning)? out|running low|buy more|what (should|do) i order/.test(t)) {
    const need = items.filter((i) => ['out_of_stock', 'reorder_now', 'low'].includes(i.stock_plan!.status));
    if (!need.length) {
      return items.some((i) => i.stock_plan!.status === 'stock_unknown')
        ? 'Nothing I can see needs reordering, but some products have no stock count yet. Add them (Account → Stock counts) so I can check those too.'
        : 'Nothing needs reordering this week. Stock covers expected sales on every forecast product.';
    }
    const budget = d.fc.store.restock_budget.now;
    return (
      `${need.length} product${need.length > 1 ? 's need' : ' needs'} ordering:\n` +
      list(need.slice(0, 6).map((i) => `${i.product.name}: order ${num(i.stock_plan!.reorder_qty)} units${i.stock_plan!.order_by ? ' ' + orderWhen(i.stock_plan!.order_by) : ''}. ${i.stock_plan!.reason}`)) +
      (budget > 0 ? `\nThe orders to place now cost about ${m(budget)}. Tools → Supplier orders writes the messages for you.` : '')
    );
  }
  if (/out of stock|sold out/.test(t)) {
    const out = items.filter((i) => i.stock_plan!.status === 'out_of_stock');
    return out.length ? `${out.length} product${out.length > 1 ? 's are' : ' is'} sold out while customers still buy:\n` + list(out.map((i) => `${i.product.name}: about ${num(i.forecast!.next_week)} a week`)) : 'Nothing that sells is out of stock right now.';
  }
  if (/not selling|dead|tied up|slow|stuck|clear|discount/.test(t)) {
    const dead = d.dash.dead_stock;
    if (!dead.length) return 'Everything with stock has sold in the last 30 days.';
    const cash = dead.reduce((x, p) => x + p.stock_qty * p.cost_price, 0);
    return `${dead.length} product${dead.length > 1 ? 's haven’t' : ' hasn’t'} sold in 30 days, with about ${m(cash)} tied up at cost:\n` + list(dead.slice(0, 5).map((p) => `${p.name}: ${p.stock_qty} in stock, ${m(p.stock_qty * p.cost_price)}`)) + '\nTry a bundle with a best seller or a 15–20% discount. Your Weekly Plan shows the lowest price that still covers cost and fees.';
  }
  if (/together|bundle|pair|cross.?sell/.test(t)) {
    const b = d.ins.bundles;
    return b.pairs.length ? 'Customers often buy these together:\n' + list(b.pairs.slice(0, 4).map((p) => `${p.a.name} + ${p.b.name}: ${p.orders_together} orders, ${p.lift}× more often than chance`)) + '\nOffer them as a bundle, or show one on the other’s page.' : b.note;
  }
  if (/next week|forecast|expect|predict|will i sell|coming week/.test(t)) {
    const s = d.fc.store;
    const top = [...items].sort((a, b) => (b.next_week_revenue ?? 0) - (a.next_week_revenue ?? 0)).slice(0, 3);
    return `Next week I expect about ${num(s.next_weeks_units[0] ?? 0)} items, ${m(s.next_weeks_revenue[0] ?? 0)} revenue and ${m(s.next_weeks_profit[0] ?? 0)} profit.\n` + list(top.map((i) => `${i.product.name}: about ${num(i.forecast!.next_week)} units (likely ${num(i.forecast!.lower[0])}–${num(i.forecast!.upper[0])})`));
  }
  if (/compar|last week|this week|how did|how am i doing|how's|how is (my|the) (store|shop|business)|week/.test(t)) {
    const k = d.dash.kpis['7d'], c = k.change;
    return `Last 7 days: ${m(k.revenue)} revenue${pctWord(c.revenue)}, ${m(k.profit)} profit after fees${pctWord(c.profit)}, ${num(k.orders)} orders${pctWord(c.orders)} and ${num(k.units)} items sold${pctWord(c.units)}, compared with the 7 days before.`;
  }
  if (/month|30 days|revenue|sales total|turnover/.test(t) && !/profit/.test(t)) {
    const k = d.dash.kpis['30d'], c = k.change;
    return `Last 30 days: ${m(k.revenue)} revenue${pctWord(c.revenue)}, ${m(k.profit)} profit after fees${pctWord(c.profit)}, ${num(k.orders)} orders and ${num(k.units)} items sold. Average order: ${m(k.avg_order_value)}.`;
  }
  if (/fee|commission/.test(t)) return `Selling fees in the last 30 days: ${m(d.dash.kpis['30d'].fees)}, already taken off your profit. Change the rates under Account → Selling fees.`;
  if (/stock value|worth|inventory value|how much stock|units on hand/.test(t)) {
    const inv = d.dash.inventory;
    return `You have ${num(inv.units_on_hand)} units on hand, worth ${m(inv.stock_value_cost)} at cost and ${m(inv.stock_value_retail)} at your selling prices.` + (inv.stock_unknown ? ` ${inv.stock_unknown} products have no stock count yet.` : '');
  }
  if (/channel|platform|where .*sell|ebay|amazon|shopify|etsy|tiktok/.test(t) && d.dash.channels.length) {
    return 'Revenue by sales channel, last 30 days:\n' + list(d.dash.channels.map((c) => `${c.channel}: ${m(c.revenue)}`));
  }
  if (/trend|booming|new product|what (else )?should i sell|add to my store/.test(t)) {
    return 'Open the Trends tab: it lists what’s selling now in your niche, with momentum, competition and what to search for on supplier sites. “Add to my store” saves an idea.';
  }
  if (/profit|best|top|most|money|earn|margin|seller|worst|losing/.test(t)) {
    const top = [...d.products].sort((a, b) => (b.profit_30d ?? 0) - (a.profit_30d ?? 0));
    const losing = d.ins.focus.items.filter((r) => r.group === 'losing');
    if (/worst|losing/.test(t)) {
      return losing.length ? `${losing.length} product${losing.length > 1 ? 's are' : ' is'} losing money after cost and fees:\n` + list(losing.slice(0, 5).map((r) => `${r.name}: ${m(r.profit)} over 90 days`)) + '\nCheck the price, or what you pay per item.' : 'No product is losing money after cost and fees.';
    }
    return `${top[0].name} made the most profit in the last 30 days: ${m(top[0].profit_30d ?? 0)} after fees.\n` + list(top.slice(1, 4).map((p) => `${p.name}: ${m(p.profit_30d ?? 0)}`)) + `\n${d.ins.focus.summary}` + (losing.length ? ` ${losing.length} product${losing.length > 1 ? 's are' : ' is'} losing money: ${losing.slice(0, 3).map((r) => r.name).join(', ')}.` : '');
  }
  const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const hit = d.products
    .map((p) => ({ p, n: words.filter((w) => `${p.name} ${p.sku}`.toLowerCase().includes(w)).length }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n)[0];
  if (hit) {
    const p = hit.p, it = items.find((i) => i.product.id === p.id);
    return (
      `${p.name}: ${p.stock_known ? `${num(p.stock_qty)} in stock` : 'no stock count yet'}, ${num(p.units_30d ?? 0)} sold in 30 days, ${m(p.profit_30d ?? 0)} profit after fees` +
      (p.margin_pct != null ? `, ${Math.round(p.margin_pct * 100)}% margin before fees.` : '.') +
      (it ? `\n• Next week: about ${num(it.forecast!.next_week)} units.\n• ${it.stock_plan!.reason}` : '')
    );
  }
  return null;
}

// ----------------------------------------------------------------------------- listing drafts

const TITLE_LIMIT: Record<string, [number, string]> = { ebay: [80, "eBay's limit"], etsy: [140, "Etsy's limit"], amazon: [200, "Amazon's usual limit"] };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface ListingDraft {
  title: string;
  titleLimit: [number, string] | null;
  short_description: string;
  bullet_points: string[];
  description: string;
  seo_keywords: string[];
  hashtags: string[];
  missing_info: string[];
}

/** A ready-to-edit listing built only from what the seller typed (nothing invented). */
export function draftListing(name: string, details: string, platform: string): ListingDraft {
  const parts = details.split(/\n|;|,(?![^(]*\))/).map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
  const limit = (TITLE_LIMIT[platform] ?? [70])[0];
  let title = name;
  for (const p of parts.slice(0, 4)) {
    const next = `${title}${title === name ? ' – ' : ', '}${cap(p)}`;
    if (next.length <= limit) title = next;
  }
  const stop = new Set(['with', 'and', 'for', 'the', 'from', 'your', 'this', 'that', 'into']);
  const words = [...new Set(`${name} ${parts.join(' ')}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w)))];
  const nameWords = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w));
  const uniq = (a: string[]) => a.filter((v, i) => a.indexOf(v) === i);
  return {
    title,
    titleLimit: TITLE_LIMIT[platform] ?? null,
    short_description: parts.length ? `${name}: ${parts.slice(0, 2).join(', ')}.` : `${name}. [Add the main benefit here.]`,
    bullet_points: parts.length ? parts.slice(0, 5).map(cap) : ['[Main benefit: what problem it solves]', '[Material and build quality]', '[Size and what’s in the box]', '[Who it’s for or a gift idea]', '[Care, warranty or returns]'],
    description:
      `${name}${parts.length ? ' – ' + parts.slice(0, 2).join(', ') : ''}.\n\n` +
      (parts.length > 2 ? parts.slice(2).map((p) => cap(p) + '.').join(' ') + '\n\n' : '') +
      "[Add one or two sentences on who it's for and why they'll love it.]\n\n" +
      (platform === 'tiktok_shop' ? 'Tap to shop before it sells out.' : 'Order today, and message us with any questions.'),
    seo_keywords: uniq([name.toLowerCase(), ...parts.slice(0, 3).map((p) => `${nameWords.slice(-1)[0] ?? ''} ${p.toLowerCase()}`.trim()), ...words.slice(0, 10)]).slice(0, 12),
    hashtags: uniq([...nameWords, ...words]).slice(0, 8).map((w) => `#${w}`),
    missing_info: parts.length < 3 ? ['Materials and size', 'What’s in the box', 'Who it’s for'] : [],
  };
}
