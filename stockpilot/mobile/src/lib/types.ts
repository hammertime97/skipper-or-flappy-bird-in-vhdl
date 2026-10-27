// Shapes returned by the StockPilot API (see backend/app).

export type Plan = 'free' | 'pro';

export interface BillingStatus {
  plan: Plan;
  plan_expires_at: string | null;
  ai_calls_used: number;
  ai_calls_limit: number;
  plans: Record<Plan, { name: string; features: string[] }>;
}

export interface User {
  id: number;
  email: string;
  store_name: string;
  niche: string;
  target_market: string;
  currency: string;
  billing: BillingStatus;
}

export type Fulfilment = 'own_stock' | 'dropship';

export interface Product {
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
  fulfilment: Fulfilment;
  image_url: string;
  stock_known: boolean;
  stage: 'active' | 'idea';
  source: string;
  archived: boolean;
  created_at: string;
  // present on list/detail endpoints
  units_7d?: number;
  units_30d?: number;
  revenue_30d?: number;
  last_sold_at?: string | null;
  days_of_stock?: number | null;
  margin_pct?: number | null;
  profit_30d?: number;
  fees_30d?: number;
}

export type StockStatus =
  | 'out_of_stock'
  | 'reorder_now'
  | 'low'
  | 'healthy'
  | 'overstock'
  | 'dead_stock'
  | 'no_demand'
  | 'stock_unknown';

export type Trend = 'rising' | 'stable' | 'declining' | 'new' | 'no_sales';

export interface Forecast {
  method: string;
  history: number[];
  weeks: number[];
  lower: number[];
  upper: number[];
  trend: Trend;
  trend_pct: number;
  confidence: 'high' | 'medium' | 'low';
  next_week: number;
  accuracy: number | null;
  tested_weeks: number;
  models: { name: string; weight: number; wape: number }[];
  seasonal: boolean;
  intermittent: boolean;
}

export interface StockPlan {
  status: StockStatus;
  weeks_of_cover: number | null;
  stockout_in_days: number | null;
  stockout_date: string | null;
  reorder_qty: number;
  safety_stock: number;
  target_stock: number;
  reason: string;
  notes: string[];
}

export interface ProductDetail extends Product {
  weekly_units: number[];
  locked: boolean;
  forecast?: Forecast;
  stock_plan?: StockPlan;
  recent_sales: { id: number; quantity: number; unit_price: number; channel: string; sold_at: string }[];
}

export interface ForecastItem {
  product: Product;
  locked: boolean;
  forecast?: Forecast;
  next_week_revenue?: number;
  next_week_profit?: number;
  stock_plan?: StockPlan;
}

export interface ForecastResponse {
  generated_at: string;
  horizon_weeks: number;
  currency: string;
  store: {
    weekly_revenue_history: number[];
    next_weeks_units: number[];
    next_weeks_revenue: number[];
    next_weeks_profit: number[];
    revenue_band: { lower: number[]; upper: number[] } | null;
    trend: Trend;
    accuracy: number | null;
    restock_budget: { now: number; next_two_weeks: number };
  };
  events: ShoppingEvent[];
  items: ForecastItem[];
  locked_count: number;
}

export interface ShoppingEvent {
  date: string;
  name: string;
  markets: string;
  in_days: number;
}

export interface Kpi {
  revenue: number;
  fees: number;
  profit: number;
  units: number;
  orders: number;
  avg_order_value: number;
  change: { revenue: number | null; profit: number | null; units: number | null; orders: number | null };
}

export interface Dashboard {
  store_name: string;
  currency: string;
  kpis: { '7d': Kpi; '30d': Kpi };
  daily: { date: string; revenue: number; units: number }[];
  channels: { channel: string; revenue: number }[];
  inventory: {
    skus: number;
    units_on_hand: number;
    stock_value_cost: number;
    stock_value_retail: number;
    out_of_stock: number;
    low_stock: number;
    dead_stock: number;
    stock_unknown: number;
    cost_missing: number;
  };
  todo: { key: 'stock' | 'cost'; count: number; text: string }[];
  top_sellers: Product[];
  low_stock: Product[];
  dead_stock: Product[];
}

export interface BriefAction {
  priority: 'high' | 'medium' | 'low';
  kind: string;
  title: string;
  detail: string;
  sku: string;
}

export interface WeeklyBriefReport {
  id: number;
  kind: 'weekly_brief';
  created_at: string;
  brief: {
    headline: string;
    summary: string;
    next_week_outlook: string;
    actions: BriefAction[];
    adjustments: { sku: string; change_pct: number; reason: string; source_url: string }[];
    market_notes: string[];
    risks: string[];
    opportunities: string[];
  };
  adjusted: {
    sku: string;
    name: string;
    base_next_week: number;
    adjusted_next_week: number;
    change_pct: number;
    reason: string;
    source_url: string;
  }[];
  store_forecast: ForecastResponse['store'];
  events: ShoppingEvent[];
  sources: Source[];
}

export interface TrendingProduct {
  name: string;
  why_trending: string;
  evidence: string;
  momentum: 'exploding' | 'rising' | 'steady';
  competition: 'low' | 'medium' | 'high';
  typical_retail_price: string;
  typical_supplier_cost: string;
  fit_with_store: string;
  how_to_sell_it: string;
  risk: string;
  est_retail_price: number;
  est_supplier_cost: number;
  supplier_search: string;
  source_urls: string[];
}

export interface Source {
  url: string;
  title: string;
}

export interface TrendReport {
  id: number;
  kind: 'trend_scout';
  created_at: string;
  niche: string;
  report: {
    niche_summary: string;
    trending_products: TrendingProduct[];
    fading_trends: string[];
    competitor_moves: string[];
    content_ideas: string[];
  };
  sources: Source[];
}

export interface ProductCheckReport {
  id: number;
  kind: 'product_check';
  created_at: string;
  idea: string;
  result: {
    verdict: 'go' | 'test_small' | 'skip';
    one_line: string;
    demand_score: number;
    competition_score: number;
    margin_score: number;
    estimated_margin: string;
    typical_retail_price: string;
    seasonality: string;
    best_channels: string[];
    target_customer: string;
    angles: string[];
    red_flags: string[];
    first_test_plan: string;
    source_urls: string[];
  };
  sources: Source[];
}

export type ListingPlatform = 'shopify' | 'tiktok_shop' | 'amazon' | 'ebay' | 'etsy' | 'woocommerce';

export interface ListingReport {
  id: number;
  kind: 'listing';
  created_at: string;
  name: string;
  platform: ListingPlatform;
  listing: {
    title: string;
    short_description: string;
    bullet_points: string[];
    description: string;
    seo_keywords: string[];
    hashtags: string[];
    missing_info: string[];
  };
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

// ---- Import ----

export interface ImportGuide {
  key: string;
  name: string;
  file_hint: string;
  what: string;
  steps: string[];
  stock_tip: string;
  tip: string;
}

export interface SampleFile {
  key: string;
  platform: string;
  title: string;
  store_name: string;
  filename: string;
}

export interface ImportSheet {
  sheet: string;
  platform: string;
  platform_name: string;
  kind: 'orders' | 'stock';
  columns: string[];
  reads: { role: string; label: string; column: string }[];
  missing: string[];
  ready: boolean;
  ai_mapped: boolean;
  examples: Record<string, string | number | null>[];
  headline: string;
  notes: string[];
}

export interface ImportPreview {
  job_id: number;
  filename: string;
  sheets: ImportSheet[];
  ready: boolean;
}

export interface ImportResult {
  sales_added: number;
  duplicates_skipped: number;
  products_created: number;
  products_updated: number;
  summary: string[];
  needs_stock: { id: number; sku: string; name: string }[];
  needs_cost: { id: number; sku: string; name: string; sell_price: number }[];
}

export interface FeeRate {
  label: string;
  pct: number;
  fixed: number;
}
