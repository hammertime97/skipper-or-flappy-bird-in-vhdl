/**
 * The import, forecasting and insight engine shared with the web preview (preview/engine.js),
 * so the app can run entirely on the phone with no server.
 */
import './engine-setup';
import './generated/engine.js';

export type Row = string[];
export interface Analysis {
  platform: string;
  kind: 'orders' | 'stock';
  header_row: number;
  columns: string[];
  mapping: Record<string, number>;
  missing: string[];
  confident: boolean;
}
export interface Extracted {
  orders: { key: string; sku: string; name: string; quantity: number; unit_price: number | null; when: number; order_ref: string; channel: string; import_key: string }[];
  stock: { key: string; sku: string; name: string; stock: number | null; cost: number | null; price: number | null }[];
  skipped_cancelled: number;
  skipped_invalid: number;
}
export interface LocalProduct {
  id: number;
  sku: string;
  name: string;
  category: string;
  cost_price: number;
  sell_price: number;
  stock_qty: number;
  incoming_qty: number;
  lead_time_days: number;
  supplier: string;
  fulfilment: 'own_stock' | 'dropship';
  stock_known: boolean;
  stage: 'active' | 'idea' | 'archived';
  source: string;
  created_at: number;
}
export interface LocalSale {
  pid: number;
  qty: number;
  price: number;
  when: number;
  channel: string;
  order: string;
}
export interface LocalStore {
  products: LocalProduct[];
  sales: LocalSale[];
  keys: Set<string>;
  nextId: number;
  user: { niche: string; market: string; currency: string; store_name: string; fees: Record<string, { pct: number; fixed: number }> };
}

export const Engine = (globalThis as any).Engine as {
  ImportProblem: new (message: string) => Error;
  readTables: (name: string, buf: ArrayBuffer) => { sheet: string; rows: Row[] }[];
  analyse: (rows: Row[]) => Analysis;
  extract: (rows: Row[], a: Analysis) => Extracted;
  summary: (a: Analysis, x: Extracted, now: number) => { headline: string; notes: string[] };
  describe: (a: Analysis) => { role: string; label: string; column: string }[];
  missingFor: (kind: string, mapping: Record<string, number>) => string[];
  newStore: () => LocalStore;
  addProduct: (store: LocalStore, fields: Partial<LocalProduct>) => LocalProduct;
  applyImport: (store: LocalStore, sheets: { a: Analysis; x: Extracted }[]) => any;
  feeTable: (fees: LocalStore['user']['fees']) => Record<string, { label: string; pct: number; fixed: number }>;
  channelKey: (channel: string) => string;
  productStats: (store: LocalStore, products: LocalProduct[], now: number) => Record<number, any>;
  activeProducts: (store: LocalStore) => LocalProduct[];
  dashboard: (store: LocalStore, now: number) => any;
  forecasts: (store: LocalStore, now: number, maxProducts: number | null, horizon?: number) => any;
  productForecast: (store: LocalStore, p: LocalProduct, now: number) => { history: number[]; fc: any; plan: any };
  upcomingEvents: (now: number, weeks?: number) => any[];
  focusList: (store: LocalStore, products: LocalProduct[], now: number) => any;
  bundles: (store: LocalStore, products: LocalProduct[], now: number) => any;
  smartPlan: (forecast: any, dash: any, focus: any, bundles: any, currency: string, today: string) => any;
  DAY: number;
};
export const ENGINE_CONFIG = (globalThis as any).ENGINE_CONFIG as {
  role_labels: Record<string, string>;
  platform_names: Record<string, string>;
  guides: any[];
  trend_library: { researched_on: string; niches: { key: string; keywords: string[] }[]; holiday: unknown };
};
