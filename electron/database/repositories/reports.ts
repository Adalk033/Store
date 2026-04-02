import { getDatabase } from '../connection';
import type { PaginatedResponse, SortSpec } from '../../../src/types/database';
import { buildLikePattern, sanitizePagination, calcLimitOffset, isValidDateFilter } from '../../lib/queryHelpers';

// Report result types
export interface DailySalesRow {
  date: string;
  count: number;
  total_cash: number;
  total_credit: number;
  total: number;
}

export interface TopProductRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
}

export interface ProfitRow {
  product_id: number;
  product_name: string;
  total_quantity: number;
  total_revenue: number;
  total_cost: number;
  profit: number;
  margin: number;
}

export interface InventoryValueRow {
  product_id: number;
  product_name: string;
  stock: number;
  min_stock: number;
  cost_price: number;
  sale_price: number;
  stock_value_cost: number;
  stock_value_sale: number;
}

export interface CreditsOverviewRow {
  status: string;
  count: number;
  total_due: number;
  total_paid: number;
  total_remaining: number;
}

export interface InventorySummary {
  total_products: number;
  total_active: number;
  total_stock_units: number;
  total_value_cost: number;
  total_value_sale: number;
  low_stock_count: number;
}

// Sales aggregated by day within a date range
export function getSalesByDateRange(startDate: string, endDate: string): DailySalesRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      DATE(created_at) AS date,
      COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN sale_type = 'cash' THEN total ELSE 0 END), 0) AS total_cash,
      COALESCE(SUM(CASE WHEN sale_type = 'credit' THEN total ELSE 0 END), 0) AS total_credit,
      COALESCE(SUM(total), 0) AS total
    FROM sales
    WHERE DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at)
    ORDER BY DATE(created_at) ASC
  `).all(startDate, endDate) as DailySalesRow[];
}

// Top N products by revenue
export function getTopProducts(startDate: string, endDate: string, limit = 10): TopProductRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(si.quantity) AS total_quantity,
      SUM(si.line_total) AS total_revenue
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE DATE(s.created_at) BETWEEN ? AND ?
    GROUP BY p.id
    ORDER BY total_revenue DESC
    LIMIT ?
  `).all(startDate, endDate, limit) as TopProductRow[];
}

// Profit report: revenue minus cost per product
export function getProfitReport(startDate: string, endDate: string): ProfitRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(si.quantity) AS total_quantity,
      SUM(si.line_total) AS total_revenue,
      SUM(si.quantity * p.cost_price) AS total_cost,
      SUM(si.line_total) - SUM(si.quantity * p.cost_price) AS profit,
      CASE
        WHEN SUM(si.line_total) > 0
        THEN ROUND((SUM(si.line_total) - SUM(si.quantity * p.cost_price)) * 100.0 / SUM(si.line_total), 2)
        ELSE 0
      END AS margin
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    WHERE DATE(s.created_at) BETWEEN ? AND ?
    GROUP BY p.id
    ORDER BY profit DESC
  `).all(startDate, endDate) as ProfitRow[];
}

// Current inventory value
export function getInventoryReport(): InventoryValueRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      id AS product_id,
      name AS product_name,
      stock,
      min_stock,
      cost_price,
      sale_price,
      ROUND(stock * cost_price, 2) AS stock_value_cost,
      ROUND(stock * sale_price, 2) AS stock_value_sale
    FROM products
    WHERE is_active = 1
    ORDER BY stock_value_cost DESC
  `).all() as InventoryValueRow[];
}

// Inventory summary totals
export function getInventorySummary(): InventorySummary {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_products,
      SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS total_active,
      COALESCE(SUM(CASE WHEN is_active = 1 THEN stock ELSE 0 END), 0) AS total_stock_units,
      COALESCE(SUM(CASE WHEN is_active = 1 THEN ROUND(stock * cost_price, 2) ELSE 0 END), 0) AS total_value_cost,
      COALESCE(SUM(CASE WHEN is_active = 1 THEN ROUND(stock * sale_price, 2) ELSE 0 END), 0) AS total_value_sale,
      SUM(CASE WHEN is_active = 1 AND min_stock >= 0 AND stock <= min_stock THEN 1 ELSE 0 END) AS low_stock_count
    FROM products
  `).get() as InventorySummary;
  return row;
}

// Credits grouped by status
export function getCreditsOverview(): CreditsOverviewRow[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT
      status,
      COUNT(*) AS count,
      COALESCE(SUM(total_due), 0) AS total_due,
      COALESCE(SUM(amount_paid), 0) AS total_paid,
      COALESCE(SUM(total_due - amount_paid), 0) AS total_remaining
    FROM credits
    GROUP BY status
    ORDER BY
      CASE status WHEN 'overdue' THEN 1 WHEN 'pending' THEN 2 WHEN 'paid' THEN 3 END
  `).all() as CreditsOverviewRow[];
}

// --- Paginated report endpoints (Phase 4) ---

const INVENTORY_SORT_FIELDS = ['product_name', 'stock', 'cost_price', 'sale_price', 'stock_value_cost', 'stock_value_sale'] as const;
const PROFIT_SORT_FIELDS = ['product_name', 'total_quantity', 'total_revenue', 'total_cost', 'profit', 'margin'] as const;
const TOP_PRODUCTS_SORT_FIELDS = ['product_name', 'total_quantity', 'total_revenue'] as const;
const CREDITS_OVERVIEW_SORT_FIELDS = ['status', 'count', 'total_due', 'total_paid', 'total_remaining'] as const;

interface ReportPaginatedQuery {
  page: number;
  pageSize: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sort?: SortSpec;
}

export function getInventoryReportPaginated(query: ReportPaginatedQuery): PaginatedResponse<InventoryValueRow> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);

  const defaultSort: SortSpec = { field: 'stock_value_cost', direction: 'DESC' };
  const sort: SortSpec = (
    query.sort &&
    typeof query.sort.field === 'string' &&
    (INVENTORY_SORT_FIELDS as readonly string[]).includes(query.sort.field) &&
    (query.sort.direction === 'ASC' || query.sort.direction === 'DESC')
  ) ? query.sort : defaultSort;

  const conditions: string[] = ['is_active = 1'];
  const params: (string | number)[] = [];

  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push("name LIKE ? ESCAPE '\\'");
    params.push(pattern);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const orderClause = `ORDER BY ${sort.field} ${sort.direction}, id DESC`;

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM products ${whereClause}
  `).get(...params) as { total: number };

  const total = countRow.total;
  const { limit, offset } = calcLimitOffset(page, pageSize);

  const items = db.prepare(`
    SELECT
      id AS product_id,
      name AS product_name,
      stock,
      min_stock,
      cost_price,
      sale_price,
      ROUND(stock * cost_price, 2) AS stock_value_cost,
      ROUND(stock * sale_price, 2) AS stock_value_sale
    FROM products
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as InventoryValueRow[];

  return { items, page, pageSize, total, hasMore: offset + items.length < total, sort };
}

export function getProfitReportPaginated(query: ReportPaginatedQuery): PaginatedResponse<ProfitRow> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);

  const defaultSort: SortSpec = { field: 'profit', direction: 'DESC' };
  const sort: SortSpec = (
    query.sort &&
    typeof query.sort.field === 'string' &&
    (PROFIT_SORT_FIELDS as readonly string[]).includes(query.sort.field) &&
    (query.sort.direction === 'ASC' || query.sort.direction === 'DESC')
  ) ? query.sort : defaultSort;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push('DATE(s.created_at) >= ?');
    params.push(query.dateFrom);
  }
  if (isValidDateFilter(query.dateTo)) {
    conditions.push('DATE(s.created_at) <= ?');
    params.push(query.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Build the base grouped query as a CTE so we can filter and paginate
  const baseQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(si.quantity) AS total_quantity,
      SUM(si.line_total) AS total_revenue,
      SUM(si.quantity * p.cost_price) AS total_cost,
      SUM(si.line_total) - SUM(si.quantity * p.cost_price) AS profit,
      CASE
        WHEN SUM(si.line_total) > 0
        THEN ROUND((SUM(si.line_total) - SUM(si.quantity * p.cost_price)) * 100.0 / SUM(si.line_total), 2)
        ELSE 0
      END AS margin
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    ${whereClause}
    GROUP BY p.id
  `;

  // Search filter applies to the grouped result
  const havingConditions: string[] = [];
  const havingParams: (string | number)[] = [];
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    havingConditions.push("product_name LIKE ? ESCAPE '\\'");
    havingParams.push(pattern);
  }

  const searchFilter = havingConditions.length > 0 ? `WHERE ${havingConditions.join(' AND ')}` : '';

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM (${baseQuery}) sub ${searchFilter}
  `).get(...params, ...havingParams) as { total: number };

  const total = countRow.total;
  const { limit, offset } = calcLimitOffset(page, pageSize);

  const orderClause = `ORDER BY ${sort.field} ${sort.direction}, product_id DESC`;

  const items = db.prepare(`
    SELECT * FROM (${baseQuery}) sub ${searchFilter} ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, ...havingParams, limit, offset) as ProfitRow[];

  return { items, page, pageSize, total, hasMore: offset + items.length < total, sort };
}

export function getTopProductsPaginated(query: ReportPaginatedQuery): PaginatedResponse<TopProductRow> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);

  const defaultSort: SortSpec = { field: 'total_revenue', direction: 'DESC' };
  const sort: SortSpec = (
    query.sort &&
    typeof query.sort.field === 'string' &&
    (TOP_PRODUCTS_SORT_FIELDS as readonly string[]).includes(query.sort.field) &&
    (query.sort.direction === 'ASC' || query.sort.direction === 'DESC')
  ) ? query.sort : defaultSort;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push('DATE(s.created_at) >= ?');
    params.push(query.dateFrom);
  }
  if (isValidDateFilter(query.dateTo)) {
    conditions.push('DATE(s.created_at) <= ?');
    params.push(query.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const baseQuery = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      SUM(si.quantity) AS total_quantity,
      SUM(si.line_total) AS total_revenue
    FROM sale_items si
    JOIN products p ON si.product_id = p.id
    JOIN sales s ON si.sale_id = s.id
    ${whereClause}
    GROUP BY p.id
  `;

  // Search filter on grouped result
  const searchConditions: string[] = [];
  const searchParams: (string | number)[] = [];
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    searchConditions.push("product_name LIKE ? ESCAPE '\\'");
    searchParams.push(pattern);
  }
  const searchFilter = searchConditions.length > 0 ? `WHERE ${searchConditions.join(' AND ')}` : '';

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM (${baseQuery}) sub ${searchFilter}
  `).get(...params, ...searchParams) as { total: number };

  const total = countRow.total;
  const { limit, offset } = calcLimitOffset(page, pageSize);

  const orderClause = `ORDER BY ${sort.field} ${sort.direction}, product_id DESC`;

  const items = db.prepare(`
    SELECT * FROM (${baseQuery}) sub ${searchFilter} ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, ...searchParams, limit, offset) as TopProductRow[];

  return { items, page, pageSize, total, hasMore: offset + items.length < total, sort };
}

export function getCreditsOverviewPaginated(query: ReportPaginatedQuery): PaginatedResponse<CreditsOverviewRow> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);

  const defaultSort: SortSpec = { field: 'status', direction: 'ASC' };
  const sort: SortSpec = (
    query.sort &&
    typeof query.sort.field === 'string' &&
    (CREDITS_OVERVIEW_SORT_FIELDS as readonly string[]).includes(query.sort.field) &&
    (query.sort.direction === 'ASC' || query.sort.direction === 'DESC')
  ) ? query.sort : defaultSort;

  const baseQuery = `
    SELECT
      status,
      COUNT(*) AS count,
      COALESCE(SUM(total_due), 0) AS total_due,
      COALESCE(SUM(amount_paid), 0) AS total_paid,
      COALESCE(SUM(total_due - amount_paid), 0) AS total_remaining
    FROM credits
    GROUP BY status
  `;

  const searchConditions: string[] = [];
  const searchParams: (string | number)[] = [];
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    searchConditions.push(`(
      LOWER(status) LIKE ? ESCAPE '\\'
      OR LOWER(CASE status
        WHEN 'pending' THEN 'pendiente'
        WHEN 'overdue' THEN 'vencido'
        WHEN 'paid' THEN 'pagado'
        ELSE status
      END) LIKE ? ESCAPE '\\'
    )`);
    searchParams.push(pattern, pattern);
  }
  const searchFilter = searchConditions.length > 0 ? `WHERE ${searchConditions.join(' AND ')}` : '';

  const countRow = db.prepare(`
    SELECT COUNT(*) AS total FROM (${baseQuery}) sub ${searchFilter}
  `).get(...searchParams) as { total: number };

  const total = countRow.total;
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const orderClause = `ORDER BY ${sort.field} ${sort.direction}, status ASC`;

  const items = db.prepare(`
    SELECT * FROM (${baseQuery}) sub ${searchFilter} ${orderClause} LIMIT ? OFFSET ?
  `).all(...searchParams, limit, offset) as CreditsOverviewRow[];

  return { items, page, pageSize, total, hasMore: offset + items.length < total, sort };
}
