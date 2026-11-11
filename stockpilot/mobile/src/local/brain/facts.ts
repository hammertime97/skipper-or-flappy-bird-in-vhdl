/**
 * The seller's numbers in a form the on-phone "brain" can query quickly: sales in any date range,
 * grouped by product, category, supplier, channel or weekday, with fees and profit worked out the
 * same way as the dashboard (price × quantity − product cost − the channel's selling fee).
 */
import { Engine as E, type LocalProduct, type LocalSale, type LocalStore } from '../engine';

export const DAY = 86_400_000;

export interface Agg {
  units: number;
  revenue: number;
  fees: number;
  cost: number;
  profit: number;
  orders: number;
  /** Sales lines with a product cost of 0: their profit is overstated. */
  costMissingUnits: number;
}

/** What the forecast engine says about one product (only for products the plan tracks). */
export interface FcItem {
  product: LocalProduct;
  locked: boolean;
  stats?: Record<string, number | null>;
  forecast?: {
    next_week: number;
    weeks: number[];
    lower: number[];
    upper: number[];
    trend: 'rising' | 'stable' | 'declining' | 'new' | 'no_sales';
    trend_pct: number;
    accuracy: number | null;
    tested_weeks: number;
    confidence: string;
    history: number[];
    seasonal: boolean;
  };
  stock_plan?: {
    status: string;
    weeks_of_cover: number | null;
    stockout_in_days: number | null;
    stockout_date: string | null;
    reorder_qty: number;
    safety_stock: number;
    target_stock: number;
    reason: string;
    notes: string[];
    order_by: string | null;
  };
  next_week_revenue?: number;
  next_week_profit?: number;
}

export interface FcData {
  items: FcItem[];
  locked_count: number;
  events: { date: string; name: string; markets: string; in_days: number }[];
  store: {
    next_weeks_units: number[];
    next_weeks_revenue: number[];
    next_weeks_profit: number[];
    revenue_band: { lower: number[]; upper: number[] } | null;
    trend: string;
    accuracy: number | null;
    restock_budget: { now: number; next_two_weeks: number };
  };
}

export const emptyAgg = (): Agg => ({ units: 0, revenue: 0, fees: 0, cost: 0, profit: 0, orders: 0, costMissingUnits: 0 });

const CHANNEL_NAMES: Record<string, string> = { ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', etsy: 'Etsy', tiktok: 'TikTok Shop', other: 'Other' };
export const channelName = (key: string) => CHANNEL_NAMES[key] ?? key;

export class Facts {
  readonly products: LocalProduct[];
  readonly byId: Map<number, LocalProduct>;
  /** Sales of active products before now, oldest first. */
  readonly sales: LocalSale[];
  readonly firstSale: number | null;
  readonly lastSale: number | null;
  private readonly feeT: Record<string, { pct: number; fixed: number }>;
  readonly fc: Map<number, FcItem>;

  constructor(
    readonly store: LocalStore,
    readonly now: number,
    readonly F: FcData,
    readonly pro: boolean,
    readonly cur: string,
    readonly limit: number,
  ) {
    this.products = E.activeProducts(store);
    this.byId = new Map(this.products.map((p) => [p.id, p]));
    this.sales = store.sales.filter((s) => s.when < now && this.byId.has(s.pid)).sort((a, b) => a.when - b.when);
    this.firstSale = this.sales.length ? this.sales[0].when : null;
    this.lastSale = this.sales.length ? this.sales[this.sales.length - 1].when : null;
    this.feeT = E.feeTable(store.user.fees);
    this.fc = new Map(F.items.map((it) => [it.product.id, it]));
  }

  fee(s: LocalSale): number {
    const f = this.feeT[E.channelKey(s.channel)] ?? { pct: 0, fixed: 0 };
    return (s.qty * s.price * f.pct) / 100 + f.fixed;
  }

  channelOf = (s: LocalSale) => E.channelKey(s.channel);

  /** Index of the first sale at or after t (sales are sorted by time). */
  private lower(t: number): number {
    let lo = 0, hi = this.sales.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.sales[mid].when < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  *between(from: number, to: number): Generator<LocalSale> {
    for (let i = this.lower(from); i < this.sales.length && this.sales[i].when < to; i++) yield this.sales[i];
  }

  /** Totals for [from, to), optionally only for some products. */
  agg(from: number, to: number, only?: Set<number> | null): Agg {
    return this.aggBy(from, to, () => 'all', only).get('all') ?? emptyAgg();
  }

  /** Totals for [from, to) grouped by key (product id, category, channel…). */
  aggBy<K>(from: number, to: number, key: (s: LocalSale, p: LocalProduct) => K, only?: Set<number> | null): Map<K, Agg> {
    const out = new Map<K, Agg>(), orders = new Map<K, Set<string>>();
    let n = 0;
    for (const s of this.between(from, to)) {
      if (only && !only.has(s.pid)) continue;
      const p = this.byId.get(s.pid)!, k = key(s, p);
      let a = out.get(k);
      if (!a) {
        out.set(k, (a = emptyAgg()));
        orders.set(k, new Set());
      }
      const rev = s.qty * s.price, fee = this.fee(s), cost = s.qty * p.cost_price;
      a.units += s.qty;
      a.revenue += rev;
      a.fees += fee;
      a.cost += cost;
      a.profit += rev - fee - cost;
      if (p.cost_price <= 0) a.costMissingUnits += s.qty;
      orders.get(k)!.add(s.order || `line-${n++}`);
    }
    for (const [k, a] of out) a.orders = orders.get(k)!.size;
    return out;
  }

  /** Average selling price, fee and profit per unit over [from, to) for one product, or null if it didn't sell. */
  unitEconomics(p: LocalProduct, from: number, to: number) {
    const a = this.agg(from, to, new Set([p.id]));
    if (!a.units) return null;
    const price = a.revenue / a.units, fee = a.fees / a.units;
    return { units: a.units, price, fee, feeRate: a.revenue ? a.fees / a.revenue : 0, profit: price - fee - p.cost_price, agg: a };
  }

  private lastSold: Map<number, number> | null = null;
  lastSoldAt(pid: number): number | null {
    if (!this.lastSold) {
      this.lastSold = new Map();
      for (const s of this.sales) this.lastSold.set(s.pid, s.when); // sorted, so the last write is the newest
    }
    return this.lastSold.get(pid) ?? null;
  }

  private feeRateMemo: number | null = null;

  /** The store's average fee as a share of revenue over the last 90 days (for products with no sales of their own). */
  storeFeeRate(): number {
    if (this.feeRateMemo == null) {
      const a = this.agg(this.now - 90 * DAY, this.now);
      this.feeRateMemo = a.revenue ? a.fees / a.revenue : 0.13;
    }
    return this.feeRateMemo;
  }

  categories(): string[] {
    return [...new Set(this.products.map((p) => (p.category || '').trim()).filter(Boolean))];
  }

  suppliers(): string[] {
    return [...new Set(this.products.map((p) => (p.supplier || '').trim()).filter(Boolean))];
  }

  private channelList: string[] | null = null;
  channels(): string[] {
    this.channelList ??= [...new Set(this.sales.map(this.channelOf))];
    return this.channelList;
  }

  money(v: number): string {
    return fmtMoney(v, this.cur);
  }
}

/** Money for chat answers: "$1,234" for big amounts, "$12.50" for small ones. */
export function fmtMoney(v: number, cur: string): string {
  const a = Math.abs(v);
  try {
    const s = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: a >= 100 ? 0 : 2, minimumFractionDigits: a >= 100 ? 0 : 2 }).format(a);
    return (v < 0 ? '-' : '') + s;
  } catch {
    return `${v < 0 ? '-' : ''}${a.toFixed(2)} ${cur}`;
  }
}

export const fmtNum = (v: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v);
export const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
export const plural = (n: number, word: string, many = `${word}s`) => `${fmtNum(n)} ${n === 1 ? word : many}`;
export const change = (cur: number, prev: number): number | null => (prev ? (cur - prev) / Math.abs(prev) : null);
export const changeWord = (c: number | null) => (c == null ? 'new' : `${c >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(c * 100))}%`);

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Tue 3 Nov" from a UTC day start (ms) or ISO date. */
export function dayLabel(t: number | string): string {
  const d = typeof t === 'string' ? new Date(`${t}T00:00:00Z`) : new Date(t);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
}
export const dayStart = (t: number) => Math.floor(t / DAY) * DAY;

/** "3 a week", "2 a month" (slow sellers read better per month). */
export function perWeek(v: number): string {
  if (v >= 1.5) return `${fmtNum(v)} a week`;
  const month = Math.round(v * 4.3);
  return month >= 1 ? `${month} a month` : 'now and then';
}
/** "today", "tomorrow", "in 5 days". */
export const inDays = (n: number) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);
