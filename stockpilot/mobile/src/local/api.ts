/**
 * On-phone mode: answers every API call with the shared engine, using data stored on the
 * phone. No account, no server, works offline. AI features need the server and say so.
 */
import { ApiError } from '@/lib/api-error';
import type { RemoteApi } from '@/lib/api';
import type {
  BillingStatus,
  Dashboard,
  ForecastResponse,
  ImportPreview,
  ImportResult,
  ImportSheet,
  Insights,
  Plan,
  Product,
  ProductDetail,
  SampleFile,
  SmartPlan,
  TrendLibrary,
  User,
} from '@/lib/types';

import { Engine as E, ENGINE_CONFIG as CFG, type Analysis, type Extracted, type LocalProduct, type LocalStore, type Row } from './engine';
import * as storage from './store';

const FREE_FORECAST_PRODUCTS = 10;
const TRENDS_URL = (process.env.EXPO_PUBLIC_TRENDS_URL ?? '').trim();
const TRENDS_MAX_AGE = 24 * 3600 * 1000; // look for a newer list at most once a day
const PREVIEW_ROWS = 4;
const DAY = E.DAY;

interface SampleBundle {
  key: string;
  platform: string;
  title: string;
  store_name: string;
  niche: string;
  files: { name: string; b64: string }[];
}

let samplesCache: SampleBundle[] | null = null;
function samples(): SampleBundle[] {
  // Loaded on first use: it's the biggest file in the app.
  samplesCache ??= require('./generated/samples.json') as SampleBundle[];
  return samplesCache;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64ToBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2] !== undefined) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] !== undefined) out[o++] = n & 255;
  }
  return out.buffer.slice(0, o);
}

const needsServer = () =>
  new ApiError(
    "AI features run on StockPilot's server, which isn't connected in on-phone mode. Everything else works on your phone.",
    503,
    'needs_server',
  );
const notFound = () => new ApiError('Not found', 404);
const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());
const r2 = (v: number) => Math.round(v * 100) / 100;

// On the phone, Pro unlocks the forecast-based features for every product (Free covers the top sellers).
const PLANS: BillingStatus['plans'] = {
  free: {
    name: 'Free',
    features: [
      'Dashboard, stock, imports, trends, calculator, product check, instant answers and listing drafts',
      `Forecasts, reorder dates and supplier orders for your top ${FREE_FORECAST_PRODUCTS} products`,
    ],
  },
  pro: {
    name: 'Pro',
    features: [
      'Forecasts and reorder dates for every product',
      'Weekly plan and supplier orders covering your whole store',
      'Everything in Free',
    ],
  },
};

interface Job {
  filename: string;
  tables: { sheet: string; rows: Row[]; a: Analysis }[];
  shift: number; // samples: move dates so the newest sale is yesterday
}

export interface LocalHandle {
  api: RemoteApi;
  setPlan: (plan: Plan) => void;
}

export async function startLocal(email = ''): Promise<LocalHandle> {
  const saved = (await storage.load()) ?? { store: E.newStore(), plan: 'free' as Plan, email };
  let store: LocalStore = saved.store;
  let plan: Plan = saved.plan;
  let version = 0;
  const jobs = new Map<number, Job>();
  let nextJob = 1;

  const persist = () => storage.save({ store, plan, email: saved.email });
  const changed = () => {
    version++;
    persist();
  };

  // ---------------------------------------------------------------- reads
  let fcCache: { key: string; data: ReturnType<typeof E.forecasts> } | null = null;
  const forecastsRaw = () => {
    const key = `${version}:${plan}`;
    if (!fcCache || fcCache.key !== key) fcCache = { key, data: E.forecasts(store, Date.now(), plan === 'pro' ? null : FREE_FORECAST_PRODUCTS) };
    return fcCache.data;
  };
  const byId = (id: number) => store.products.find((p) => p.id === Number(id) && p.stage !== 'archived');

  function productOut(p: LocalProduct, stats?: Record<string, unknown>): Product {
    const out: Product = {
      id: p.id, sku: p.sku, name: p.name, category: p.category ?? '', cost_price: p.cost_price, sell_price: p.sell_price,
      stock_qty: p.stock_qty, incoming_qty: p.incoming_qty ?? 0, lead_time_days: p.lead_time_days ?? 7, supplier: p.supplier ?? '',
      fulfilment: p.fulfilment ?? 'own_stock', image_url: '', stock_known: p.stock_known, stage: p.stage === 'idea' ? 'idea' : 'active',
      source: p.source ?? '', archived: p.stage === 'archived', created_at: iso(p.created_at) ?? new Date().toISOString(),
    };
    if (stats) {
      const st = stats as Record<string, number | null>;
      Object.assign(out, {
        units_7d: st.units_7d, units_30d: st.units_30d, revenue_30d: r2(st.revenue_30d ?? 0), fees_30d: r2(st.fees_30d ?? 0),
        profit_30d: r2(st.profit_30d ?? 0), days_of_stock: st.days_of_stock, margin_pct: st.margin_pct, last_sold_at: iso(st.last_sold_at),
      });
    }
    return out;
  }

  const billing = (): BillingStatus => ({ plan, plan_expires_at: null, ai_calls_used: 0, ai_calls_limit: 0, plans: PLANS });
  const me = (): User => ({
    id: 0, email: saved.email || 'On this phone', store_name: store.user.store_name, niche: store.user.niche,
    target_market: store.user.market, currency: store.user.currency || 'USD', billing: billing(),
  });

  function dashboard(): Dashboard {
    const d = E.dashboard(store, Date.now());
    const out = (ps: LocalProduct[]) => ps.map((p) => productOut(p, d.stats[p.id]));
    return {
      store_name: store.user.store_name, currency: store.user.currency || 'USD', kpis: d.kpis, daily: d.daily, channels: d.channels,
      inventory: d.inventory, todo: d.todo, top_sellers: out(d.top_sellers), low_stock: out(d.low_stock), dead_stock: out(d.dead_stock),
    };
  }

  function forecasts(): ForecastResponse {
    const F = forecastsRaw();
    return {
      generated_at: new Date().toISOString(), horizon_weeks: 4, currency: store.user.currency || 'USD', store: F.store, events: F.events,
      locked_count: F.locked_count,
      items: F.items.map((it: { product: LocalProduct; stats?: Record<string, unknown>; locked: boolean }) => ({ ...it, product: productOut(it.product, it.stats), stats: undefined })),
    };
  }

  function insightsData(): Insights {
    const now = Date.now(), ps = E.activeProducts(store);
    return { focus: E.focusList(store, ps, now), bundles: E.bundles(store, ps, now) };
  }

  // ---------------------------------------------------------------- import
  function shifted(x: Extracted & { first?: number | null; last?: number | null }, shift: number): Extracted {
    if (!shift) return x;
    for (const o of x.orders) o.when += shift;
    if (x.first != null) x.first += shift;
    if (x.last != null) x.last += shift;
    return x;
  }

  function sheetPreview(t: Job['tables'][number], shift: number): ImportSheet {
    const a = t.a;
    const x = a.missing.length ? null : shifted(E.extract(t.rows, a), shift);
    const examples = !x
      ? []
      : a.kind === 'orders'
        ? x.orders.slice(0, PREVIEW_ROWS).map((o) => ({ date: new Date(o.when).toISOString().slice(0, 10), product: o.name, quantity: o.quantity, price: o.unit_price }))
        : x.stock.slice(0, PREVIEW_ROWS).map((s) => ({ product: s.name, sku: s.sku, stock: s.stock, cost: s.cost, price: s.price }));
    const summary = x ? E.summary(a, x, Date.now()) : { headline: 'We need your help with a few columns.', notes: [] };
    return {
      sheet: t.sheet, platform: a.platform, platform_name: CFG.platform_names[a.platform] ?? a.platform, kind: a.kind, columns: a.columns,
      reads: E.describe(a), missing: a.missing.map((m) => CFG.role_labels[m]), ready: !!x && (x.orders.length > 0 || x.stock.length > 0),
      ai_mapped: false, examples, headline: summary.headline, notes: summary.notes,
    };
  }

  function readFile(name: string, buf: ArrayBuffer): Job['tables'] {
    try {
      const tables = E.readTables(name, buf).map(({ sheet, rows }) => ({ sheet, rows, a: E.analyse(rows) }));
      if (tables.every((t) => t.rows.length <= t.a.header_row + 1)) {
        throw new E.ImportProblem('We found the column headings but no rows under them. Check the date range when you download the file.');
      }
      return tables;
    } catch (e) {
      if (e instanceof E.ImportProblem) throw new ApiError(e.message, 400, 'import_error');
      throw new ApiError("We couldn't read this file. Try exporting it again as CSV.", 400, 'import_error');
    }
  }

  function newJob(filename: string, tables: Job['tables'], shift = 0): ImportPreview {
    const id = nextJob++;
    jobs.set(id, { filename, tables, shift });
    const sheets = tables.map((t) => sheetPreview(t, shift));
    return { job_id: id, filename, sheets, ready: sheets.some((s) => s.ready) };
  }

  function sampleTables(key: string) {
    const s = samples().find((x) => x.key === key);
    if (!s) throw notFound();
    const tables = s.files.flatMap((f, i) =>
      readFile(f.name, b64ToBuffer(f.b64)).map((t) => ({ ...t, sheet: i === 0 ? t.sheet : t.sheet || f.name })),
    );
    let newest = 0;
    for (const t of tables) if (t.a.kind === 'orders' && !t.a.missing.length) for (const o of E.extract(t.rows, t.a).orders) newest = Math.max(newest, o.when);
    const yesterday = Math.floor(Date.now() / DAY) * DAY - DAY;
    const shift = newest ? Math.round((yesterday - Math.floor(newest / DAY) * DAY) / DAY) * DAY : 0;
    return { s, tables, shift };
  }

  function applyJob(job: Job, overrides: { index: number; kind?: string; mapping?: Record<string, string | null> }[] = []): ImportResult {
    for (const o of overrides) {
      const t = job.tables[o.index];
      if (!t) continue;
      const mapping = { ...t.a.mapping };
      for (const [role, col] of Object.entries(o.mapping ?? {})) {
        if (!col) delete mapping[role];
        else if (t.a.columns.includes(col)) mapping[role] = t.a.columns.indexOf(col);
      }
      const kind = (o.kind === 'stock' || o.kind === 'orders' ? o.kind : t.a.kind) as Analysis['kind'];
      t.a = { ...t.a, kind, mapping, missing: E.missingFor(kind, mapping) };
    }
    const ok = job.tables.filter((t) => !t.a.missing.length).map((t) => ({ a: t.a, x: shifted(E.extract(t.rows, t.a), job.shift) }));
    if (!ok.length) throw new ApiError('Pick the missing columns first.', 400, 'import_error');
    const res = E.applyImport(store, ok);
    changed();
    return {
      sales_added: res.sales_added, duplicates_skipped: res.duplicates_skipped, products_created: res.products_created,
      products_updated: res.products_updated, summary: res.summary,
      needs_stock: res.needs_stock.map((p: LocalProduct) => ({ id: p.id, sku: p.sku, name: p.name })),
      needs_cost: res.needs_cost.map((p: LocalProduct) => ({ id: p.id, sku: p.sku, name: p.name, sell_price: p.sell_price })),
    };
  }

  function nameStoreAfter(s: SampleBundle) {
    if (!store.user.store_name) store.user.store_name = s.store_name;
    if (!store.user.niche) store.user.niche = s.niche;
  }

  // ---------------------------------------------------------------- the API
  const api: RemoteApi = {
    register: async () => { throw needsServer(); },
    login: async () => { throw needsServer(); },
    me: async () => me(),
    updateMe: async (patch) => {
      if (patch.store_name !== undefined) store.user.store_name = patch.store_name;
      if (patch.niche !== undefined) store.user.niche = patch.niche;
      if (patch.target_market !== undefined) store.user.market = patch.target_market;
      if (patch.currency !== undefined) {
        const c = patch.currency.trim().toUpperCase();
        try {
          new Intl.NumberFormat('en-US', { style: 'currency', currency: c });
          store.user.currency = c;
        } catch {
          throw new ApiError(`${c} isn't a currency code we know. Use one like USD, GBP or EUR.`, 400);
        }
      }
      changed();
      return me();
    },
    billing: async () => billing(),

    dashboard: async () => dashboard(),
    products: async (q = '') => {
      const ql = q.toLowerCase(), ps = E.activeProducts(store).filter((p) => !ql || `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(ql));
      const st = E.productStats(store, ps, Date.now());
      return ps.map((p) => productOut(p, st[p.id]));
    },
    product: async (id) => {
      const p = byId(id);
      if (!p) throw notFound();
      const now = Date.now(), st = E.productStats(store, [p], now)[p.id], { history, fc, plan: sp } = E.productForecast(store, p, now);
      const locked = p.stage === 'active' && forecastsRaw().items.some((it: { product: LocalProduct; locked: boolean }) => it.locked && it.product.id === p.id);
      const recent = store.sales.map((s, i) => ({ s, i })).filter(({ s }) => s.pid === p.id && s.when < now).sort((a, b) => b.s.when - a.s.when).slice(0, 20);
      const out: ProductDetail = {
        ...productOut(p, st), weekly_units: history, locked,
        recent_sales: recent.map(({ s, i }) => ({ id: i, quantity: s.qty, unit_price: s.price, channel: s.channel, sold_at: new Date(s.when).toISOString() })),
      };
      if (!locked) Object.assign(out, { forecast: fc, stock_plan: sp });
      return out;
    },
    createProduct: async (body) => {
      if (store.products.some((p) => p.stage !== 'archived' && p.sku.toUpperCase() === body.sku.toUpperCase())) {
        throw new ApiError(`SKU ${body.sku} already exists`, 409);
      }
      const p = E.addProduct(store, { ...body, stock_known: true, stage: 'active', created_at: Date.now() } as Partial<LocalProduct>);
      changed();
      return productOut(p);
    },
    updateProduct: async (id, patch) => {
      const p = byId(id);
      if (!p) throw notFound();
      Object.assign(p, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined && v !== null)));
      if (patch.stock_qty !== undefined) p.stock_known = true;
      changed();
      return productOut(p);
    },
    archiveProduct: async (id) => {
      const p = byId(id);
      if (p) p.stage = 'archived';
      changed();
    },
    adjustStock: async (id, delta, receiveIncoming = false) => {
      const p = byId(id);
      if (!p) throw notFound();
      p.stock_qty = (p.stock_known ? p.stock_qty : 0) + delta;
      p.stock_known = true;
      if (receiveIncoming && delta > 0) p.incoming_qty = Math.max(0, (p.incoming_qty ?? 0) - delta);
      changed();
      return productOut(p);
    },
    recordSale: async (productId, quantity, unitPrice, channel = '') => {
      const p = byId(productId);
      if (!p) throw notFound();
      const now = Date.now();
      store.sales.push({ pid: p.id, qty: quantity, price: unitPrice ?? p.sell_price, when: now - 1000, channel, order: `manual-${now}` });
      if (p.stock_known) p.stock_qty -= quantity;
      changed();
      return { product_id: p.id, quantity };
    },
    forecasts: async () => forecasts(),
    importGuides: async () => ({ guides: CFG.guides, roles: CFG.role_labels }),
    importSamples: async () =>
      samples().map((s): SampleFile => ({ key: s.key, platform: s.platform, title: s.title, store_name: s.store_name, filename: s.files[0].name })),
    uploadFile: async (file) => {
      const buf = await storage.readPicked(file);
      if (buf.byteLength > 25 * 1024 * 1024) throw new ApiError('Files must be under 25 MB. Export a shorter date range.', 413);
      return newJob(file.name, readFile(file.name, buf));
    },
    trySample: async (key) => {
      const { s, tables, shift } = sampleTables(key);
      const preview = newJob(s.files.map((f) => f.name).join(' + '), tables, shift);
      sampleFor.set(preview.job_id, s);
      return preview;
    },
    confirmImport: async (jobId, sheets = []) => {
      const job = jobs.get(jobId);
      if (!job) throw new ApiError('This upload has expired. Please choose the file again.', 400, 'import_error');
      const res = applyJob(job, sheets);
      const s = sampleFor.get(jobId);
      if (s) nameStoreAfter(s);
      jobs.delete(jobId);
      changed();
      return res;
    },
    setStockCounts: async (items) => {
      let updated = 0;
      for (const it of items) {
        const p = byId(it.id);
        if (!p) continue;
        p.stock_qty = Math.round(it.stock_qty);
        p.stock_known = true;
        updated++;
      }
      changed();
      return { updated };
    },
    setCosts: async (items) => {
      let updated = 0;
      for (const it of items) {
        const p = byId(it.id);
        if (!p) continue;
        p.cost_price = Math.max(0, it.cost_price);
        updated++;
      }
      changed();
      return { updated };
    },
    fees: async () => ({ fees: E.feeTable(store.user.fees), note: 'Typical rates for most categories. Change them to match your account.' }),
    saveFees: async (fees) => {
      store.user.fees = fees;
      changed();
      return { fees: E.feeTable(store.user.fees) };
    },
    ideas: async () =>
      store.products.filter((p) => p.stage === 'idea').sort((a, b) => b.created_at - a.created_at).map((p) => productOut(p)),
    addIdea: async (idea) => {
      if (store.products.some((p) => p.stage === 'idea' && p.name.toLowerCase() === idea.name.toLowerCase())) {
        throw new ApiError('This idea is already on your list.', 409, 'exists');
      }
      const p = E.addProduct(store, {
        sku: `IDEA-${String(store.nextId).padStart(4, '0')}`, name: idea.name, stage: 'idea', stock_known: false,
        sell_price: idea.est_price ?? 0, cost_price: idea.est_cost ?? 0, category: (idea.note ?? '').slice(0, 120), source: 'trends', created_at: Date.now(),
      });
      changed();
      return productOut(p);
    },
    startSelling: async (id, body) => {
      const p = store.products.find((x) => x.id === id && x.stage === 'idea');
      if (!p) throw notFound();
      if (body.sku) {
        if (store.products.some((x) => x.id !== p.id && x.stage !== 'archived' && x.sku === body.sku)) throw new ApiError(`SKU ${body.sku} is already used.`, 409, 'sku_taken');
        p.sku = body.sku;
      } else if (p.sku.startsWith('IDEA-')) p.sku = `NEW-${p.sku.slice(5)}`;
      if (body.sell_price !== undefined) p.sell_price = body.sell_price;
      if (body.cost_price !== undefined) p.cost_price = body.cost_price;
      if (body.stock_qty !== undefined) {
        p.stock_qty = body.stock_qty;
        p.stock_known = true;
      }
      if (body.fulfilment === 'own_stock' || body.fulfilment === 'dropship') p.fulfilment = body.fulfilment;
      p.stage = 'active';
      changed();
      return productOut(p);
    },
    removeIdea: async (id) => {
      store.products = store.products.filter((p) => !(p.id === id && p.stage === 'idea'));
      changed();
    },
    insights: async () => insightsData(),
    plan: async (): Promise<SmartPlan> => {
      const F = forecastsRaw(), ins = insightsData();
      const plan = E.smartPlan(F, E.dashboard(store, Date.now()), ins.focus, ins.bundles, store.user.currency || 'USD', new Date().toISOString().slice(0, 10));
      return { ...plan, store_forecast: F.store, events: F.events };
    },
    trendLibrary: async (): Promise<TrendLibrary> => {
      const lib = await latestTrends(), t = (store.user.niche || '').toLowerCase();
      let match: string | null = null, best = 0;
      for (const n of lib.niches) {
        const score = n.keywords.filter((k) => t.includes(k)).length;
        if (score > best) [match, best] = [n.key, score];
      }
      return { ...(lib as unknown as Omit<TrendLibrary, 'match'>), match };
    },
    seedDemo: async () => {
      store = E.newStore();
      const { s, tables, shift } = sampleTables('ebay');
      applyJob({ filename: 'demo', tables, shift });
      nameStoreAfter(s);
      changed();
      return { products: E.activeProducts(store).length, sales: store.sales.length };
    },

    weeklyBrief: async () => { throw needsServer(); },
    trendScout: async () => { throw needsServer(); },
    productCheck: async () => { throw needsServer(); },
    ask: async () => { throw needsServer(); },
    listing: async () => { throw needsServer(); },
    reports: async () => [],
  };
  const sampleFor = new Map<number, SampleBundle>();

  /** The newest trends list we have: downloaded (when online), else the last download, else the one in the app. */
  async function latestTrends(): Promise<typeof CFG.trend_library> {
    const bundled = CFG.trend_library;
    const cached = await storage.loadTrends();
    let best = cached && isLibrary(cached.lib) && cached.lib.researched_on >= bundled.researched_on ? cached.lib : bundled;
    if (TRENDS_URL && (!cached || Date.now() - cached.fetchedAt > TRENDS_MAX_AGE)) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(TRENDS_URL, { signal: ctrl.signal });
        clearTimeout(timer);
        const remote: unknown = res.ok ? await res.json() : null;
        if (isLibrary(remote)) {
          await storage.saveTrends({ fetchedAt: Date.now(), lib: remote });
          if (remote.researched_on >= best.researched_on) best = remote;
        }
      } catch {
        // Offline or slow: use what we have.
      }
    }
    return best;
  }

  return {
    api,
    setPlan: (p) => {
      plan = p;
      changed();
    },
  };
}

export const wipeLocal = storage.wipe;

/** A downloaded trends list must have the shape the app expects before we show it. */
function isLibrary(v: unknown): v is typeof CFG.trend_library {
  const lib = v as { researched_on?: unknown; niches?: unknown; holiday?: unknown } | null;
  return (
    !!lib &&
    typeof lib.researched_on === 'string' &&
    !!lib.holiday &&
    Array.isArray(lib.niches) &&
    lib.niches.length > 0 &&
    lib.niches.every(
      (n: { key?: unknown; name?: unknown; keywords?: unknown; summary?: unknown; items?: unknown }) =>
        typeof n.key === 'string' && typeof n.name === 'string' && Array.isArray(n.keywords) && Array.isArray(n.items) &&
        (n.items as { name?: unknown; source?: unknown }[]).every((it) => typeof it.name === 'string' && typeof it.source === 'string'),
    )
  );
}
