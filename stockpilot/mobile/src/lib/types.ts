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
  archived: boolean;
  created_at: string;
  // present on list/detail endpoints
  units_7d?: number;
  units_30d?: number;
  revenue_30d?: number;
  last_sold_at?: string | null;
  days_of_stock?: number | null;
  margin_pct?: number | null;
}

export type StockStatus =
  | 'out_of_stock'
  | 'reorder_now'
  | 'low'
  | 'healthy'
  | 'overstock'
  | 'dead_stock'
  | 'no_demand';

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
}

export interface StockPlan {
  status: StockStatus;
  weeks_of_cover: number | null;
  stockout_in_days: number | null;
  stockout_date: string | null;
  reorder_qty: number;
  safety_stock: number;
  reason: string;
  notes: string[];
}

export interface ProductDetail extends Product {
  weekly_units: number[];
  forecast: Forecast;
  stock_plan: StockPlan;
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
  };
  items: ForecastItem[];
  locked_count: number;
}

export interface Kpi {
  revenue: number;
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
  };
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
    risks: string[];
    opportunities: string[];
  };
  store_forecast: ForecastResponse['store'];
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
