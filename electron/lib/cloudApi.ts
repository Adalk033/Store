import crypto from 'node:crypto';
import type {
  CashMovement,
  CashRegisterPeriod,
  Category,
  Customer,
  CustomerListItem,
  CustomersPaginatedQuery,
  Credit,
  CreditListItem,
  CreditPayment,
  CreditsSummary,
  CreditPaymentListItem,
  InventoryMovement,
  InventoryMovementListItem,
  PaginatedQuery,
  PaginatedResponse,
  Product,
  Sale,
  SaleDetail,
  SaleListItem,
  SortSpec,
  Setting,
} from '../../src/types/database';

export type CloudSettingsSection = 'store' | 'products' | 'credits';

export type CloudSectionValues = Record<string, string>;

type CloudConfig = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  retryMax: number;
};

type ApiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    details?: string[];
    request_id?: string;
  };
  request_id?: string;
};

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toFiniteInteger(value: unknown): number | undefined {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined) return undefined;
  return Math.trunc(parsed);
}

function normalizeTimestamp(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function normalizeCashRegisterPeriodRow(raw: unknown): CashRegisterPeriod {
  const row = raw as Record<string, unknown>;
  return {
    ...row,
    id: toFiniteInteger(row.id) ?? 0,
    opening_cash: toFiniteNumber(row.opening_cash) ?? 0,
    total_cash_sales: toFiniteNumber(row.total_cash_sales) ?? 0,
    total_credit_sales: toFiniteNumber(row.total_credit_sales) ?? 0,
    total_credit_collected: toFiniteNumber(row.total_credit_collected) ?? 0,
    total_expenses: toFiniteNumber(row.total_expenses) ?? 0,
    closing_cash: row.closing_cash != null ? (toFiniteNumber(row.closing_cash) ?? null) : null,
    version: toFiniteInteger(row.version) ?? 1,
  } as CashRegisterPeriod;
}

function normalizeCashMovementRow(raw: unknown): CashMovement {
  const row = raw as Record<string, unknown>;
  return {
    ...row,
    id: toFiniteInteger(row.id) ?? 0,
    cash_register_id: toFiniteInteger(row.cash_register_id) ?? 0,
    amount: toFiniteNumber(row.amount) ?? 0,
  } as CashMovement;
}

function normalizeCreditPaymentListItemRow(raw: unknown): CreditPaymentListItem {
  const row = raw as Record<string, unknown>;
  return {
    ...row,
    id: toFiniteInteger(row.id) ?? 0,
    credit_id: toFiniteInteger(row.credit_id) ?? 0,
    amount: toFiniteNumber(row.amount) ?? 0,
    cash_register_id: row.cash_register_id != null ? (toFiniteInteger(row.cash_register_id) ?? null) : null,
    sale_id: toFiniteInteger(row.sale_id) ?? 0,
    customer_id: toFiniteInteger(row.customer_id) ?? 0,
  } as CreditPaymentListItem;
}

function normalizeProductRow(raw: unknown): Product {
  if (typeof raw !== 'object' || raw === null) {
    return raw as Product;
  }

  const row = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...row };

  const id = toFiniteInteger(row.id);
  if (id !== undefined) normalized.id = id;

  const categoryId = row.category_id;
  if (categoryId === null) {
    normalized.category_id = null;
  } else {
    const parsedCategoryId = toFiniteInteger(categoryId);
    if (parsedCategoryId !== undefined) normalized.category_id = parsedCategoryId;
  }

  const costPrice = toFiniteNumber(row.cost_price);
  if (costPrice !== undefined) normalized.cost_price = costPrice;
  const marginPercent = toFiniteNumber(row.margin_percent);
  if (marginPercent !== undefined) normalized.margin_percent = marginPercent;
  const salePrice = toFiniteNumber(row.sale_price);
  if (salePrice !== undefined) normalized.sale_price = salePrice;

  const stock = toFiniteNumber(row.stock);
  if (stock !== undefined) normalized.stock = stock;
  const minStock = toFiniteNumber(row.min_stock);
  if (minStock !== undefined) normalized.min_stock = minStock;

  const isActive = toFiniteInteger(row.is_active);
  if (isActive !== undefined) normalized.is_active = isActive;

  normalized.created_at = normalizeTimestamp(row.created_at);
  normalized.updated_at = normalizeTimestamp(row.updated_at);

  return normalized as unknown as Product;
}

function normalizeSaleListRow(raw: unknown): SaleListItem {
  if (typeof raw !== 'object' || raw === null) {
    return raw as SaleListItem;
  }

  const row = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...row };

  const id = toFiniteInteger(row.id);
  if (id !== undefined) normalized.id = id;

  const customerId = row.customer_id;
  if (customerId === null) {
    normalized.customer_id = null;
  } else {
    const parsedCustomerId = toFiniteInteger(customerId);
    if (parsedCustomerId !== undefined) normalized.customer_id = parsedCustomerId;
  }

  const cashRegisterId = row.cash_register_id;
  if (cashRegisterId === null) {
    normalized.cash_register_id = null;
  } else {
    const parsedCashRegisterId = toFiniteInteger(cashRegisterId);
    if (parsedCashRegisterId !== undefined) normalized.cash_register_id = parsedCashRegisterId;
  }

  const itemCount = toFiniteNumber(row.item_count ?? row.itemCount);
  normalized.item_count = itemCount ?? 0;

  const subtotal = toFiniteNumber(row.subtotal);
  if (subtotal !== undefined) normalized.subtotal = subtotal;

  const surcharge = toFiniteNumber(row.surcharge);
  if (surcharge !== undefined) normalized.surcharge = surcharge;

  const total = toFiniteNumber(row.total);
  if (total !== undefined) normalized.total = total;

  const cashReceived = row.cash_received;
  if (cashReceived === null) {
    normalized.cash_received = null;
  } else {
    const parsedCashReceived = toFiniteNumber(cashReceived);
    if (parsedCashReceived !== undefined) normalized.cash_received = parsedCashReceived;
  }

  const cashChange = row.cash_change;
  if (cashChange === null) {
    normalized.cash_change = null;
  } else {
    const parsedCashChange = toFiniteNumber(cashChange);
    if (parsedCashChange !== undefined) normalized.cash_change = parsedCashChange;
  }

  normalized.created_at = normalizeTimestamp(row.created_at);
  return normalized as unknown as SaleListItem;
}

function normalizeSaleDetailRow(raw: unknown): SaleDetail {
  if (typeof raw !== 'object' || raw === null) {
    return raw as SaleDetail;
  }

  const row = raw as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...row };

  const id = toFiniteInteger(row.id);
  if (id !== undefined) normalized.id = id;

  const customerId = row.customer_id;
  if (customerId === null) {
    normalized.customer_id = null;
  } else {
    const parsedCustomerId = toFiniteInteger(customerId);
    if (parsedCustomerId !== undefined) normalized.customer_id = parsedCustomerId;
  }

  const cashRegisterId = row.cash_register_id;
  if (cashRegisterId === null) {
    normalized.cash_register_id = null;
  } else {
    const parsedCashRegisterId = toFiniteInteger(cashRegisterId);
    if (parsedCashRegisterId !== undefined) normalized.cash_register_id = parsedCashRegisterId;
  }

  const subtotal = toFiniteNumber(row.subtotal);
  if (subtotal !== undefined) normalized.subtotal = subtotal;

  const surcharge = toFiniteNumber(row.surcharge);
  if (surcharge !== undefined) normalized.surcharge = surcharge;

  const total = toFiniteNumber(row.total);
  if (total !== undefined) normalized.total = total;

  const rawItems = Array.isArray(row.items) ? row.items : [];
  normalized.items = rawItems.map((itemRaw) => {
    if (typeof itemRaw !== 'object' || itemRaw === null) {
      return itemRaw;
    }

    const item = itemRaw as Record<string, unknown>;
    const itemNormalized: Record<string, unknown> = { ...item };

    const itemId = toFiniteInteger(item.id);
    if (itemId !== undefined) itemNormalized.id = itemId;

    const saleId = toFiniteInteger(item.sale_id);
    if (saleId !== undefined) itemNormalized.sale_id = saleId;

    const productId = toFiniteInteger(item.product_id);
    if (productId !== undefined) itemNormalized.product_id = productId;

    const quantity = toFiniteNumber(item.quantity);
    if (quantity !== undefined) itemNormalized.quantity = quantity;

    const unitPrice = toFiniteNumber(item.unit_price);
    if (unitPrice !== undefined) itemNormalized.unit_price = unitPrice;

    const lineTotal = toFiniteNumber(item.line_total);
    if (lineTotal !== undefined) itemNormalized.line_total = lineTotal;

    return itemNormalized;
  });

  normalized.created_at = normalizeTimestamp(row.created_at);
  return normalized as unknown as SaleDetail;
}

function toUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.replace(/^\/+/, '');
  const url = new URL(normalizedPath, normalizedBase);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && `${value}`.trim() !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function normalizeErrorMessage(
  responseStatus: number,
  url: string,
  envelope?: ApiEnvelope<unknown>,
  rawText?: string
): string {
  if (envelope?.error?.message) {
    return envelope.error.message;
  }
  if (responseStatus === 403 && rawText?.toLowerCase().includes('missing authentication token')) {
    return `Ruta no encontrada en API cloud (${url}). Verifica que aws_api_base_url incluya el stage, por ejemplo /prod`;
  }
  if (responseStatus === 401 || responseStatus === 403) {
    return `No autorizado para consumir API cloud (${responseStatus}) en ${url}`;
  }
  if (responseStatus === 404) {
    return `Recurso no encontrado en API cloud (${url})`;
  }
  if (responseStatus === 400) {
    return `Solicitud invalida en API cloud (${url}). Verifica formato del body y tipos esperados por el modelo del API Gateway`;
  }
  if (responseStatus >= 500) {
    return `Error interno en API cloud (${responseStatus})`; 
  }
  return `Error HTTP ${responseStatus} en API cloud (${url})`;
}

function paginateArray<T>(items: T[], page: number, pageSize: number): { slice: T[]; page: number; pageSize: number; total: number; hasMore: boolean } {
  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, pageSize);
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;
  return {
    slice: items.slice(start, end),
    page: safePage,
    pageSize: safePageSize,
    total: items.length,
    hasMore: end < items.length,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class CloudApi {
  private readonly getConfig: () => CloudConfig;

  constructor(getConfig: () => CloudConfig) {
    this.getConfig = getConfig;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const config = this.getConfig();
    const url = toUrl(config.baseUrl, path, query);

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= config.retryMax) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetch(url, {
          method,
          headers: {
            'content-type': 'application/json',
            'x-api-key': config.apiKey,
            'x-request-id': crypto.randomUUID(),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const text = await response.text();
        const envelope = text ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;

        if (!response.ok || !envelope?.ok) {
          throw new Error(normalizeErrorMessage(response.status, url, envelope, text));
        }

        return envelope.data as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error('Error desconocido llamando API cloud');
        if (attempt >= config.retryMax) {
          throw lastError;
        }

        const backoffMs = Math.min(2000, 250 * (2 ** attempt));
        const jitterMs = Math.floor(Math.random() * 150);
        await wait(backoffMs + jitterMs);
      } finally {
        clearTimeout(timer);
      }
      attempt += 1;
    }

    throw lastError ?? new Error('Error inesperado llamando API cloud');
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.request<{ status?: string }>('GET', '/v1/health');
      return response.status === 'ok';
    } catch {
      return false;
    }
  }

  // Categories
  getCategories(): Promise<Category[]> {
    return this.request<Category[]>('GET', '/v1/categories');
  }

  private toCategoryWritePayload(data: { name?: string; parent_id?: number | null }): { name?: string; parent_id?: number } {
    const payload: { name?: string; parent_id?: number } = {};
    if (typeof data.name === 'string') {
      payload.name = data.name;
    }
    if (typeof data.parent_id === 'number' && Number.isInteger(data.parent_id) && data.parent_id > 0) {
      payload.parent_id = data.parent_id;
    }
    return payload;
  }

  private toProductWritePayload(data: {
    barcode?: string;
    name?: string;
    description?: string | null;
    category_id?: number | null;
    cost_price?: number;
    margin_percent?: number;
    stock?: number;
    min_stock?: number;
    is_active?: number;
  }): {
    barcode?: string;
    name?: string;
    description?: string;
    category_id?: number;
    cost_price?: number;
    margin_percent?: number;
    stock?: number;
    min_stock?: number;
    is_active?: number;
  } {
    const payload: {
      barcode?: string;
      name?: string;
      description?: string;
      category_id?: number;
      cost_price?: number;
      margin_percent?: number;
      stock?: number;
      min_stock?: number;
      is_active?: number;
    } = {};

    if (typeof data.barcode === 'string') payload.barcode = data.barcode;
    if (typeof data.name === 'string') payload.name = data.name;
    if (typeof data.description === 'string' && data.description.trim()) payload.description = data.description;
    if (typeof data.category_id === 'number' && Number.isInteger(data.category_id) && data.category_id > 0) {
      payload.category_id = data.category_id;
    }
    if (typeof data.cost_price === 'number') payload.cost_price = data.cost_price;
    if (typeof data.margin_percent === 'number') payload.margin_percent = data.margin_percent;
    if (typeof data.stock === 'number') payload.stock = Math.trunc(data.stock);
    if (typeof data.min_stock === 'number') payload.min_stock = Math.trunc(data.min_stock);
    if (typeof data.is_active === 'number') payload.is_active = data.is_active;

    return payload;
  }

  // Settings (cloud-managed sections)
  getSettingsSection(section: CloudSettingsSection): Promise<{ section: CloudSettingsSection; values: CloudSectionValues }> {
    return this.request<{ section: CloudSettingsSection; values: CloudSectionValues }>('GET', `/v1/settings/sections/${section}`);
  }

  updateSettingsSection(
    section: CloudSettingsSection,
    values: CloudSectionValues
  ): Promise<{ section: CloudSettingsSection; values: CloudSectionValues }> {
    return this.request<{ section: CloudSettingsSection; values: CloudSectionValues }>('PUT', `/v1/settings/sections/${section}`, {
      values,
    });
  }

  async getSettingsSectionRows(section: CloudSettingsSection): Promise<Setting[]> {
    const response = await this.getSettingsSection(section);
    return Object.entries(response.values).map(([key, value]) => ({ key, value }));
  }

  createCategory(data: { name: string; parent_id?: number | null }): Promise<Category> {
    return this.request<Category>('POST', '/v1/categories', this.toCategoryWritePayload(data));
  }

  updateCategory(id: number, data: { name?: string; parent_id?: number | null }): Promise<Category | undefined> {
    return this.request<Category>('PUT', `/v1/categories/${id}`, this.toCategoryWritePayload(data));
  }

  deleteCategory(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/categories/${id}`).then((r) => r.deleted);
  }

  // Customers
  getCustomers(query?: { search?: string; status?: string; credit_status?: string }): Promise<CustomerListItem[]> {
    return this.request<CustomerListItem[]>('GET', '/v1/customers', undefined, query);
  }

  getCustomerById(id: number): Promise<Customer | undefined> {
    return this.request<Customer>('GET', `/v1/customers/${id}`);
  }

  createCustomer(data: {
    name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  }): Promise<Customer> {
    return this.request<Customer>('POST', '/v1/customers', data);
  }

  updateCustomer(id: number, data: {
    name?: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
    is_active?: number;
  }): Promise<Customer | undefined> {
    return this.request<Customer>('PUT', `/v1/customers/${id}`, data);
  }

  deleteCustomer(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/customers/${id}`).then((r) => r.deleted);
  }

  async getCustomersPaginated(query: CustomersPaginatedQuery): Promise<PaginatedResponse<CustomerListItem>> {
    const all = await this.getCustomers({
      search: query.search,
      status: query.status,
      credit_status: query.creditStatus,
    });

    const { slice, page, pageSize, total, hasMore } = paginateArray(all, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'name', direction: 'ASC' },
    };
  }

  // Products
  async getProducts(query?: { search?: string; category_id?: number; low_stock?: boolean }): Promise<Product[]> {
    const raw = await this.request<unknown>('GET', '/v1/products', undefined, query);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeProductRow);
  }

  async getProductById(id: number): Promise<Product | undefined> {
    const raw = await this.request<unknown>('GET', `/v1/products/${id}`);
    if (!raw) return undefined;
    return normalizeProductRow(raw);
  }

  async getProductByBarcode(barcode: string): Promise<Product | undefined> {
    const raw = await this.request<unknown>('GET', `/v1/products/barcode/${encodeURIComponent(barcode)}`);
    if (!raw) return undefined;
    return normalizeProductRow(raw);
  }

  async getLowStockProducts(): Promise<Product[]> {
    const raw = await this.request<unknown>('GET', '/v1/products/low-stock');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeProductRow);
  }

  createProduct(data: {
    barcode: string;
    name: string;
    description?: string | null;
    category_id?: number | null;
    cost_price: number;
    margin_percent: number;
    stock?: number;
    min_stock?: number;
  }): Promise<Product> {
    return this.request<unknown>('POST', '/v1/products', this.toProductWritePayload(data)).then(normalizeProductRow);
  }

  updateProduct(id: number, data: {
    name?: string;
    description?: string | null;
    category_id?: number | null;
    cost_price?: number;
    margin_percent?: number;
    min_stock?: number;
    is_active?: number;
  }): Promise<Product | undefined> {
    return this.request<unknown>('PUT', `/v1/products/${id}`, this.toProductWritePayload(data)).then((raw) =>
      raw ? normalizeProductRow(raw) : undefined
    );
  }

  deleteProduct(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/products/${id}`).then((r) => r.deleted);
  }

  canDeleteProductPermanently(id: number): Promise<boolean> {
    return this.request<{ canDelete: boolean }>('GET', `/v1/products/${id}/can-delete-permanently`).then((r) => r.canDelete);
  }

  deleteProductPermanently(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/products/${id}/permanent`).then((r) => r.deleted);
  }

  async getProductsPaginated(query: PaginatedQuery & {
    categoryId?: number;
    lowStock?: boolean;
    startsWith?: string;
    stockMode?: 'eq' | 'lte' | 'gte';
    stockValue?: number;
  }): Promise<PaginatedResponse<Product>> {
    const sort = query.sort ?? ({ field: 'name', direction: 'ASC' } as SortSpec);
    const all = await this.getProducts({
      search: query.search,
      category_id: query.categoryId,
      low_stock: query.lowStock,
    });

    let filtered = query.status === 'active'
      ? all.filter((p) => p.is_active === 1)
      : query.status === 'inactive'
      ? all.filter((p) => p.is_active === 0)
      : all;

    if (query.startsWith === '0-9') {
      filtered = filtered.filter((p) => /^\d/.test((p.name || '').trim()));
    } else if (typeof query.startsWith === 'string' && /^[A-Z]$/.test(query.startsWith)) {
      const startsWith = query.startsWith.toUpperCase();
      filtered = filtered.filter((p) => (p.name || '').toUpperCase().startsWith(startsWith));
    }

    if (
      (query.stockMode === 'eq' || query.stockMode === 'lte' || query.stockMode === 'gte') &&
      typeof query.stockValue === 'number' &&
      Number.isFinite(query.stockValue) &&
      query.stockValue >= 0
    ) {
      const stockValue = Math.trunc(query.stockValue);
      filtered = filtered.filter((p) => {
        if (query.stockMode === 'eq') return p.stock === stockValue;
        if (query.stockMode === 'lte') return p.stock <= stockValue;
        return p.stock >= stockValue;
      });
    }

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sort.field === 'created_at') {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        comparison = (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0);
      } else {
        comparison = (a.name || '').localeCompare((b.name || ''), 'es', { sensitivity: 'base' });
      }

      if (comparison === 0) {
        comparison = a.id - b.id;
      }

      return sort.direction === 'DESC' ? -comparison : comparison;
    });

    const start = (Math.max(1, query.page) - 1) * Math.max(1, query.pageSize);
    const end = start + Math.max(1, query.pageSize);
    const items = sorted.slice(start, end);

    return {
      items,
      page: Math.max(1, query.page),
      pageSize: Math.max(1, query.pageSize),
      total: sorted.length,
      hasMore: end < sorted.length,
      sort,
    };
  }

  // Cash register
  getCurrentCashRegister(): Promise<CashRegisterPeriod | null> {
    return this.request<CashRegisterPeriod | null>('GET', '/v1/cash-register/current')
      .then((row) => row ? normalizeCashRegisterPeriodRow(row) : null);
  }

  openCashRegister(data: { period_name: string; start_date: string; opening_cash: number }): Promise<CashRegisterPeriod> {
    return this.request<CashRegisterPeriod>('POST', '/v1/cash-register/open', data)
      .then(normalizeCashRegisterPeriodRow);
  }

  closeCashRegister(data: { id: number; closing_cash: number; end_date: string }): Promise<CashRegisterPeriod> {
    return this.request<CashRegisterPeriod>('POST', '/v1/cash-register/close', data)
      .then(normalizeCashRegisterPeriodRow);
  }

  getCashRegisterPeriods(): Promise<CashRegisterPeriod[]> {
    return this.request<CashRegisterPeriod[]>('GET', '/v1/cash-register/periods')
      .then((rows) => rows.map(normalizeCashRegisterPeriodRow));
  }

  async getCashRegisterPeriodsPaginated(
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CashRegisterPeriod>> {
    const all = await this.getCashRegisterPeriods();
    const filtered = (query.status && query.status.trim())
      ? all.filter((p) => p.status === query.status)
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  addCashMovement(data: {
    cash_register_id: number;
    type: 'expense' | 'withdrawal' | 'deposit';
    amount: number;
    description?: string | null;
    movement_date?: string;
    idempotency_key?: string;
  }): Promise<CashMovement> {
    return this.request<CashMovement>('POST', '/v1/cash-register/movements', data)
      .then(normalizeCashMovementRow);
  }

  getCashMovements(cashRegisterId: number): Promise<CashMovement[]> {
    return this.request<CashMovement[]>('GET', `/v1/cash-register/${cashRegisterId}/movements`)
      .then((rows) => rows.map(normalizeCashMovementRow));
  }

  updateCashMovement(id: number, data: {
    type?: 'expense' | 'withdrawal' | 'deposit';
    amount?: number;
    description?: string | null;
    movement_date?: string;
  }): Promise<CashMovement> {
    return this.request<CashMovement>('PUT', `/v1/cash-register/movements/${id}`, data)
      .then(normalizeCashMovementRow);
  }

  deleteCashMovement(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/cash-register/movements/${id}`)
      .then((r) => r.deleted);
  }

  getCashRegisterSales(cashRegisterId: number): Promise<SaleListItem[]> {
    return this.request<SaleListItem[]>('GET', `/v1/cash-register/${cashRegisterId}/sales`)
      .then((rows) => rows.map(normalizeSaleListRow));
  }

  getCashRegisterCreditPayments(cashRegisterId: number): Promise<CreditPaymentListItem[]> {
    return this.request<CreditPaymentListItem[]>(
      'GET',
      `/v1/cash-register/${cashRegisterId}/credit-payments`
    ).then((rows) => rows.map(normalizeCreditPaymentListItemRow));
  }

  getCashRegisterSalesSummary(cashRegisterId: number): Promise<{
    sale_count: number;
    total_cash_sales: number;
    total_credit_sales: number;
    total_credit_collected: number;
  }> {
    return this.request<{
      sale_count: number;
      total_cash_sales: number;
      total_credit_sales: number;
      total_credit_collected: number;
    }>('GET', `/v1/cash-register/${cashRegisterId}/sales-summary`);
  }

  async getCashRegisterSalesPaginated(
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<SaleListItem>> {
    const all = await this.getCashRegisterSales(cashRegisterId);
    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((s) => {
          const customer = (s.customer_name || '').toLowerCase();
          return customer.includes(search) || String(s.id).includes(search);
        })
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  async getCashRegisterCreditPaymentsPaginated(
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CreditPaymentListItem>> {
    const all = await this.getCashRegisterCreditPayments(cashRegisterId);
    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((cp) => {
          const customer = (cp.customer_name || '').toLowerCase();
          return customer.includes(search) || String(cp.id).includes(search);
        })
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  async getCashMovementsPaginated(
    cashRegisterId: number,
    query: PaginatedQuery
  ): Promise<PaginatedResponse<CashMovement>> {
    const all = await this.getCashMovements(cashRegisterId);
    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((m) => {
          const desc = (m.description || '').toLowerCase();
          return desc.includes(search) || String(m.id).includes(search);
        })
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  // Sales
  createSale(data: {
    sale_type: 'cash' | 'credit';
    customer_id?: number | null;
    sale_date?: string;
    items: Array<{ product_id: number; quantity: number; unit_price: number }>;
    cash_register_id?: number | null;
    credit_days?: number;
    surcharge_percent?: number;
    initial_payment?: number;
    cash_received?: number;
    cash_change?: number;
    idempotency_key?: string;
  }): Promise<Sale> {
    return this.request<{ sale: Sale; created: boolean }>('POST', '/v1/sales', data).then((r) => r.sale);
  }

  async getSales(query?: { type?: string; date_from?: string; date_to?: string }): Promise<SaleListItem[]> {
    const raw = await this.request<unknown>('GET', '/v1/sales', undefined, query);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeSaleListRow);
  }

  getSaleById(id: number): Promise<Sale | undefined> {
    return this.request<Sale>('GET', `/v1/sales/${id}`);
  }

  deleteSale(id: number): Promise<boolean> {
    return this.request<{ deleted: boolean }>('DELETE', `/v1/sales/${id}`).then((r) => r.deleted);
  }

  async getSaleDetailById(id: number): Promise<SaleDetail | undefined> {
    const raw = await this.request<unknown>('GET', `/v1/sales/${id}/detail`);
    if (!raw) return undefined;
    return normalizeSaleDetailRow(raw);
  }

  async getSalesPaginated(query: PaginatedQuery): Promise<PaginatedResponse<SaleListItem>> {
    const all = await this.getSales({
      type: query.type,
      date_from: query.dateFrom,
      date_to: query.dateTo,
    });

    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((s) => {
          const customer = (s.customer_name || '').toLowerCase();
          return customer.includes(search) || String(s.id).includes(search) || String(s.total).includes(search);
        })
      : all;

    const start = (Math.max(1, query.page) - 1) * Math.max(1, query.pageSize);
    const end = start + Math.max(1, query.pageSize);
    const items = filtered.slice(start, end);

    return {
      items,
      page: Math.max(1, query.page),
      pageSize: Math.max(1, query.pageSize),
      total: filtered.length,
      hasMore: end < filtered.length,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  getSalesSummary(query?: { search?: string; type?: string; dateFrom?: string; dateTo?: string }): Promise<{
    totalSales: number;
    totalRevenue: number;
    cashRevenue: number;
    creditRevenue: number;
  }> {
    return this.request<{ totalSales: number; totalRevenue: number; cashRevenue: number; creditRevenue: number }>(
      'GET',
      '/v1/sales/summary',
      undefined,
      {
        search: query?.search,
        type: query?.type,
        date_from: query?.dateFrom,
        date_to: query?.dateTo,
      }
    );
  }

  // Credits
  getCredits(status?: string): Promise<Credit[]> {
    return this.request<Credit[]>('GET', '/v1/credits', undefined, { status });
  }

  getCreditById(id: number): Promise<Credit | undefined> {
    return this.request<Credit>('GET', `/v1/credits/${id}`);
  }

  getCreditsByCustomer(customerId: number): Promise<Credit[]> {
    return this.request<Credit[]>('GET', `/v1/customers/${customerId}/credits`);
  }

  addCreditPayment(creditId: number, amount: number, paymentDate?: string, idempotencyKey?: string): Promise<Credit> {
    return this.request<{ credit: Credit; created: boolean }>('POST', `/v1/credits/${creditId}/payments`, {
      amount,
      payment_date: paymentDate,
      idempotency_key: idempotencyKey,
    }).then((r) => r.credit);
  }

  getCreditPayments(creditId: number): Promise<CreditPayment[]> {
    return this.request<CreditPayment[]>('GET', `/v1/credits/${creditId}/payments`);
  }

  checkOverdueCredits(): Promise<number> {
    return this.request<{ updated_count: number }>('POST', '/v1/credits/recalculate-overdue').then((r) => r.updated_count);
  }

  async getCreditsPaginated(query: PaginatedQuery): Promise<PaginatedResponse<CreditListItem>> {
    const all = await this.getCredits(query.status);
    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((c) => String(c.id).includes(search) || String(c.sale_id).includes(search))
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered as CreditListItem[], query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  async getCreditsByCustomerPaginated(customerId: number, query: PaginatedQuery): Promise<PaginatedResponse<CreditListItem>> {
    const all = await this.getCreditsByCustomer(customerId);
    const statusFiltered = typeof query.status === 'string' ? all.filter((c) => c.status === query.status) : all;
    const { slice, page, pageSize, total, hasMore } = paginateArray(statusFiltered as CreditListItem[], query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  async getCreditPaymentsPaginated(creditId: number, query: PaginatedQuery): Promise<PaginatedResponse<CreditPayment>> {
    const all = await this.getCreditPayments(creditId);
    const { slice, page, pageSize, total, hasMore } = paginateArray(all, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  getCreditsSummary(query?: { search?: string; status?: string; dateFrom?: string; dateTo?: string }): Promise<CreditsSummary> {
    return this.request<CreditsSummary>('GET', '/v1/credits/summary', undefined, {
      search: query?.search,
      status: query?.status,
      date_from: query?.dateFrom,
      date_to: query?.dateTo,
    });
  }

  // Inventory
  addInventoryMovement(data: {
    product_id: number;
    type: 'in' | 'out' | 'adjustment';
    quantity: number;
    reference_id?: number | null;
    notes?: string | null;
    cost_price?: number;
    margin_percent?: number;
  }): Promise<InventoryMovement> {
    return this.request<InventoryMovement>('POST', '/v1/inventory/movements', data);
  }

  getInventoryMovements(query?: { type?: string }): Promise<InventoryMovementListItem[]> {
    return this.request<InventoryMovementListItem[]>('GET', '/v1/inventory/movements', undefined, query);
  }

  getInventoryMovementsByProduct(productId: number): Promise<InventoryMovementListItem[]> {
    return this.request<InventoryMovementListItem[]>('GET', `/v1/products/${productId}/inventory-movements`);
  }

  async getInventoryMovementsPaginated(query: PaginatedQuery): Promise<PaginatedResponse<InventoryMovementListItem>> {
    const all = await this.getInventoryMovements({ type: query.type });
    const search = (query.search || '').trim().toLowerCase();
    const filtered = search
      ? all.filter((m) => (m.product_name || '').toLowerCase().includes(search) || (m.product_barcode || '').toLowerCase().includes(search))
      : all;

    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  async getInventoryMovementsByProductPaginated(productId: number, query: PaginatedQuery): Promise<PaginatedResponse<InventoryMovementListItem>> {
    const all = await this.getInventoryMovementsByProduct(productId);
    const filtered = typeof query.type === 'string' ? all.filter((m) => m.type === query.type) : all;
    const { slice, page, pageSize, total, hasMore } = paginateArray(filtered, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }

  // Reports
  getSalesByDate(startDate: string, endDate: string): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('GET', '/v1/reports/sales-by-date', undefined, {
      start_date: startDate,
      end_date: endDate,
    });
  }

  getTopProducts(startDate: string, endDate: string, limit?: number): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('GET', '/v1/reports/top-products', undefined, {
      start_date: startDate,
      end_date: endDate,
      limit,
    });
  }

  getProfitReport(startDate: string, endDate: string): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('GET', '/v1/reports/profit', undefined, {
      start_date: startDate,
      end_date: endDate,
    });
  }

  getInventoryReport(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('GET', '/v1/reports/inventory');
  }

  getInventorySummary(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('GET', '/v1/reports/inventory-summary');
  }

  getCreditsOverview(): Promise<Array<Record<string, unknown>>> {
    return this.request<Array<Record<string, unknown>>>('GET', '/v1/reports/credits-overview');
  }

  async getReportPaginated<T>(
    source: Promise<T[]>,
    query: { page: number; pageSize: number; sort?: SortSpec }
  ): Promise<PaginatedResponse<T>> {
    const all = await source;
    const { slice, page, pageSize, total, hasMore } = paginateArray(all, query.page, query.pageSize);
    return {
      items: slice,
      page,
      pageSize,
      total,
      hasMore,
      sort: query.sort ?? { field: 'created_at', direction: 'DESC' },
    };
  }
}
