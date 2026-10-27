import type {
  BillingStatus,
  FeeRate,
  ImportGuide,
  ImportPreview,
  ImportResult,
  SampleFile,
  ChatTurn,
  Dashboard,
  ForecastResponse,
  ListingPlatform,
  ListingReport,
  Product,
  ProductCheckReport,
  ProductDetail,
  TrendReport,
  User,
  WeeklyBriefReport,
} from './types';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }

  /** The server wants the user to upgrade (free AI quota used, or a Pro-only feature). */
  get needsUpgrade() {
    return this.status === 402 && this.code === 'upgrade_required';
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    const detail = data?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      throw new ApiError(detail.message ?? 'Something went wrong', res.status, detail.code);
    }
    if (Array.isArray(detail)) {
      // FastAPI validation errors
      throw new ApiError(detail.map((d: { msg: string }) => d.msg).join('\n'), res.status, 'validation');
    }
    throw new ApiError(typeof detail === 'string' ? detail : 'Something went wrong', res.status);
  }
  return data as T;
}

export type ProductInput = Omit<Product, 'id' | 'archived' | 'created_at' | 'stock_known' | 'stage' | 'source'>;

export const api = {
  register: (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { email, password }),
  me: () => request<User>('GET', '/me'),
  updateMe: (patch: Partial<Pick<User, 'store_name' | 'niche' | 'target_market' | 'currency'>>) =>
    request<User>('PATCH', '/me', patch),
  billing: () => request<BillingStatus>('GET', '/billing/status'),

  dashboard: () => request<Dashboard>('GET', '/dashboard'),
  products: (q = '') => request<Product[]>('GET', `/products${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  product: (id: number) => request<ProductDetail>('GET', `/products/${id}`),
  createProduct: (p: ProductInput) => request<Product>('POST', '/products', p),
  updateProduct: (id: number, patch: Partial<ProductInput>) => request<Product>('PATCH', `/products/${id}`, patch),
  archiveProduct: (id: number) => request<void>('DELETE', `/products/${id}`),
  adjustStock: (id: number, delta: number, receiveIncoming = false) =>
    request<Product>('POST', `/products/${id}/stock`, { delta, receive_incoming: receiveIncoming }),
  recordSale: (productId: number, quantity: number, unitPrice?: number, channel = '') =>
    request('POST', '/sales', { product_id: productId, quantity, unit_price: unitPrice, channel }),
  forecasts: (horizon = 4) => request<ForecastResponse>('GET', `/forecasts?horizon=${horizon}`),
  importGuides: () => request<{ guides: ImportGuide[]; roles: Record<string, string> }>('GET', '/import/guides'),
  importSamples: () => request<SampleFile[]>('GET', '/import/samples'),
  uploadFile: (file: { uri: string; name: string; mimeType?: string }) => {
    const form = new FormData();
    // React Native's FormData accepts { uri, name, type } file parts.
    form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'text/csv' } as unknown as Blob);
    return request<ImportPreview>('POST', '/import/upload', undefined, form);
  },
  trySample: (key: string) => request<ImportPreview>('POST', `/import/samples/${key}/try`),
  confirmImport: (
    jobId: number,
    sheets: { index: number; skip?: boolean; kind?: string; mapping?: Record<string, string | null> }[] = [],
  ) => request<ImportResult>('POST', `/import/${jobId}/confirm`, { sheets }),
  setStockCounts: (items: { id: number; stock_qty: number }[]) =>
    request<{ updated: number }>('POST', '/products/stock-counts', { items }),
  setCosts: (items: { id: number; cost_price: number }[]) => request<{ updated: number }>('POST', '/products/costs', { items }),
  fees: () => request<{ fees: Record<string, FeeRate>; note: string }>('GET', '/me/fees'),
  saveFees: (fees: Record<string, { pct: number; fixed: number }>) =>
    request<{ fees: Record<string, FeeRate> }>('PUT', '/me/fees', fees),
  ideas: () => request<Product[]>('GET', '/ai/ideas'),
  addIdea: (idea: { name: string; est_price?: number; est_cost?: number; note?: string; report_id?: number }) =>
    request<Product>('POST', '/ai/ideas', idea),
  startSelling: (id: number, body: { sku?: string; sell_price?: number; cost_price?: number; stock_qty?: number; fulfilment?: string }) =>
    request<Product>('POST', `/ai/ideas/${id}/start-selling`, body),
  removeIdea: (id: number) => request<void>('DELETE', `/ai/ideas/${id}`),
  seedDemo: () => request<{ products: number; sales: number }>('POST', '/demo/seed'),

  weeklyBrief: () => request<WeeklyBriefReport>('POST', '/ai/weekly-brief'),
  trendScout: (niche?: string, market?: string) =>
    request<TrendReport>('POST', '/ai/trend-scout', { niche: niche || null, market: market || null }),
  productCheck: (idea: string, unitCost?: number, sellPrice?: number) =>
    request<ProductCheckReport>('POST', '/ai/product-check', { idea, unit_cost: unitCost, sell_price: sellPrice }),
  ask: (question: string, history: ChatTurn[]) =>
    request<{ id: number; answer: string }>('POST', '/ai/assistant', { question, history }),
  listing: (input: { product_id?: number; name?: string; details?: string; platform: ListingPlatform; tone?: string }) =>
    request<ListingReport>('POST', '/ai/listing', input),
  reports: <T>(kind: string, limit = 10) => request<T[]>('GET', `/ai/reports?kind=${kind}&limit=${limit}`),
};
