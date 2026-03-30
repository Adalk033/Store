import { getDatabase } from '../connection';

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
      SUM(CASE WHEN is_active = 1 AND stock <= min_stock THEN 1 ELSE 0 END) AS low_stock_count
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
