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
} from '../../src/types/database';

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
      } finally {
        clearTimeout(timer);
      }
      attempt += 1;
    }

    throw lastError ?? new Error('Error inesperado llamando API cloud');
  }

  // Categories
  getCategories(): Promise<Category[]> {
    return this.request<Category[]>('GET', '/v1/categories');
  }

  createCategory(data: { name: string; parent_id?: number | null }): Promise<Category> {
    return this.request<Category>('POST', '/v1/categories', data);
  }

  updateCategory(id: number, data: { name?: string; parent_id?: number | null }): Promise<Category | undefined> {
    return this.request<Category>('PUT', `/v1/categories/${id}`, data);
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
  getProducts(query?: { search?: string; category_id?: number; low_stock?: boolean }): Promise<Product[]> {
    return this.request<Product[]>('GET', '/v1/products', undefined, query);
  }

  getProductById(id: number): Promise<Product | undefined> {
    return this.request<Product>('GET', `/v1/products/${id}`);
  }

  getProductByBarcode(barcode: string): Promise<Product | undefined> {
    return this.request<Product>('GET', `/v1/products/barcode/${encodeURIComponent(barcode)}`);
  }

  getLowStockProducts(): Promise<Product[]> {
    return this.request<Product[]>('GET', '/v1/products/low-stock');
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
    return this.request<Product>('POST', '/v1/products', data);
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
    return this.request<Product>('PUT', `/v1/products/${id}`, data);
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

  async getProductsPaginated(query: PaginatedQuery & { categoryId?: number; lowStock?: boolean }): Promise<PaginatedResponse<Product>> {
    const sort = query.sort ?? ({ field: 'name', direction: 'ASC' } as SortSpec);
    const all = await this.getProducts({
      search: query.search,
      category_id: query.categoryId,
      low_stock: query.lowStock,
    });

    const filtered = typeof query.status === 'string'
      ? all.filter((p) => (query.status === 'active' ? p.is_active === 1 : p.is_active === 0))
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
      sort,
    };
  }

  // Cash register
  getCurrentCashRegister(): Promise<CashRegisterPeriod | null> {
    return this.request<CashRegisterPeriod | null>('GET', '/v1/cash-register/current');
  }

  openCashRegister(data: { period_name: string; start_date: string; opening_cash: number }): Promise<CashRegisterPeriod> {
    return this.request<CashRegisterPeriod>('POST', '/v1/cash-register/open', data);
  }

  closeCashRegister(data: { id: number; closing_cash: number; end_date: string }): Promise<CashRegisterPeriod> {
    return this.request<CashRegisterPeriod>('POST', '/v1/cash-register/close', data);
  }

  getCashRegisterPeriods(): Promise<CashRegisterPeriod[]> {
    return this.request<CashRegisterPeriod[]>('GET', '/v1/cash-register/periods');
  }

  addCashMovement(data: {
    cash_register_id: number;
    type: 'expense' | 'withdrawal' | 'deposit';
    amount: number;
    description?: string | null;
    idempotency_key?: string;
  }): Promise<CashMovement> {
    return this.request<CashMovement>('POST', '/v1/cash-register/movements', data);
  }

  getCashMovements(cashRegisterId: number): Promise<CashMovement[]> {
    return this.request<CashMovement[]>('GET', `/v1/cash-register/${cashRegisterId}/movements`);
  }

  getCashRegisterSales(cashRegisterId: number): Promise<SaleListItem[]> {
    return this.request<SaleListItem[]>('GET', `/v1/cash-register/${cashRegisterId}/sales`);
  }

  getCashRegisterCreditPayments(cashRegisterId: number): Promise<CreditPaymentListItem[]> {
    return this.request<CreditPaymentListItem[]>(
      'GET',
      `/v1/cash-register/${cashRegisterId}/credit-payments`
    );
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

  getSales(query?: { type?: string; date_from?: string; date_to?: string }): Promise<SaleListItem[]> {
    return this.request<SaleListItem[]>('GET', '/v1/sales', undefined, query);
  }

  getSaleById(id: number): Promise<Sale | undefined> {
    return this.request<Sale>('GET', `/v1/sales/${id}`);
  }

  getSaleDetailById(id: number): Promise<SaleDetail | undefined> {
    return this.request<SaleDetail>('GET', `/v1/sales/${id}/detail`);
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

  addCreditPayment(creditId: number, amount: number, idempotencyKey?: string): Promise<Credit> {
    return this.request<{ credit: Credit; created: boolean }>('POST', `/v1/credits/${creditId}/payments`, {
      amount,
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

  async getReportPaginated(
    source: Promise<Array<Record<string, unknown>>>,
    query: { page: number; pageSize: number; sort?: SortSpec }
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
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
