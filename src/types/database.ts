// Entity types returned by the cloud API

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  created_at: string;
}

export interface Product {
  id: number;
  barcode: string;
  name: string;
  description: string | null;
  category_id: number | null;
  category_name?: string | null;
  cost_price: number;
  margin_percent: number;
  sale_price: number; // GENERATED STORED column
  stock: number;
  min_stock: number;
  is_active: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
}

export interface Sale {
  captured_at?: string | null;
  id: number;
  sale_type: 'cash' | 'credit';
  customer_id: number | null;
  subtotal: number;
  surcharge: number;
  total: number;
  cash_received: number | null;
  cash_change: number | null;
  cash_register_id: number | null;
  created_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  line_total: number; // GENERATED STORED column
}

export interface SaleListItem extends Sale {
  customer_name: string | null;
  item_count: number;
}

export interface SaleDetailItem extends SaleItem {
  product_name: string;
  product_barcode: string;
}

export interface SaleDetail extends Sale {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  items: SaleDetailItem[];
  // Credit info (populated only for credit sales)
  credit_due_date: string | null;
  credit_created_at: string | null;
  credit_days: number | null;
}

export interface Credit {
  id: number;
  sale_id: number;
  customer_id: number;
  original_amount: number;
  due_date: string;
  surcharge_percent: number;
  surcharge_applied: number; // 0 or 1
  total_due: number;
  amount_paid: number;
  status: 'pending' | 'overdue' | 'paid';
  paid_at: string | null;
  created_at: string;
}

export interface CreditPayment {
  id: number;
  credit_id: number;
  amount: number;
  cash_register_id: number | null;
  created_at: string;
}

export interface CreditListItem extends Credit {
  customer_name: string | null;
}

export interface CustomerListItem extends Customer {
  total_credits: number;
  active_credits: number;
  overdue_credits: number;
  total_debt: number;
  total_paid: number;
  last_credit_date: string | null;
}

export interface CreditsSummary {
  countActive: number;
  totalPending: number;
  totalOverdue: number;
  totalCollected: number;
}

export interface CreditPaymentListItem extends CreditPayment {
  sale_id: number;
  customer_id: number;
  customer_name: string | null;
  credit_status: Credit['status'];
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reference_id: number | null;
  notes: string | null;
  created_at: string;
}

export interface InventoryMovementListItem extends InventoryMovement {
  product_name: string;
  product_barcode: string;
}

export interface PeriodCorrection {
  id: number;
  version: number;
  start_date: string;
  end_date: string;
  opening_cash: number;
  closing_cash: number;
}

export interface SaleTransfer {
  sale_id: number;
  source_id: number;
  source_version: number;
  target_id: number;
  target_version: number;
  sale_date: string;
}

export interface CashRegisterPeriod {
  id: number;
  period_name: string;
  start_date: string;
  end_date: string | null;
  opening_cash: number;
  total_cash_sales: number;
  total_credit_sales: number;
  total_credit_collected: number;
  total_expenses: number;
  total_deposits: number;
  total_withdrawals: number;
  closing_cash: number | null;
  status: 'open' | 'closed';
  version: number;
  created_at: string;
}

export interface CashMovement {
  id: number;
  cash_register_id: number;
  type: 'expense' | 'withdrawal' | 'deposit';
  amount: number;
  description: string | null;
  created_at: string;
}

export interface Setting {
  key: string;
  value: string;
}

// --- Paginated query contract (Fase 0 - Scalability) ---

/**
 * Sort direction for query results.
 */
export type SortDirection = 'ASC' | 'DESC';

/**
 * Sort specification for paginated queries.
 * Default for chronological listings: { field: 'created_at', direction: 'DESC' }
 * Secondary sort is always id DESC for stable ordering.
 */
export interface SortSpec {
  field: string;
  direction: SortDirection;
}

/**
 * Common filter parameters used across all paginated list endpoints.
 * All fields are optional; only provided fields are applied as AND conditions.
 */
export interface QueryFilters {
  search?: string;       // Text search (case-insensitive, accent-normalized, contains)
  dateFrom?: string;     // ISO date string YYYY-MM-DD (inclusive)
  dateTo?: string;       // ISO date string YYYY-MM-DD (inclusive)
  status?: string;       // Entity-specific status filter (e.g., 'pending', 'open', 'active')
  type?: string;         // Entity-specific type filter (e.g., 'cash', 'credit', 'in', 'out')
}

/**
 * Request parameters for paginated queries.
 * Sent from renderer to main process via IPC.
 */
export interface PaginatedQuery extends QueryFilters {
  page: number;          // 1-based page number
  pageSize: number;      // Items per page (default depends on module, typical: 25-50)
  sort?: SortSpec;       // Optional sort override; defaults to created_at DESC, id DESC
}

export type CustomerCreditStatusFilter = 'all' | 'withDebt' | 'overdue' | 'withoutCredits';

export interface CustomersPaginatedQuery extends PaginatedQuery {
  creditStatus?: CustomerCreditStatusFilter;
}

/**
 * Standard paginated response returned from main process to renderer.
 * All paginated list endpoints must return this shape.
 */
export interface PaginatedResponse<T> {
  items: T[];            // Current page of results
  page: number;          // Current page number (1-based, mirrors request)
  pageSize: number;      // Items per page (mirrors request)
  total: number;         // Total count of items matching filters (exact)
  hasMore: boolean;      // Whether more pages exist after current page
  sort: SortSpec;        // Sort used for this response
}

/**
 * Feature flag module identifiers for gradual migration.
 * Each module can be toggled independently to use paginated endpoints.
 */
export type FeatureFlagModule =
  | 'cash'
  | 'sales'
  | 'inventory'
  | 'credits'
  | 'customers'
  | 'products'
  | 'reports';

// --- Idempotency (Phase 5 - Hardening cloud) ---

/**
 * Result wrapper for idempotent operations.
 * `created` is true if a new record was inserted, false if an existing one was returned.
 */
export interface IdempotentResult<T> {
  data: T;
  created: boolean;
}

// --- Metrics (Phase 5 - Hardening cloud) ---

/**
 * Single metric entry recorded per IPC call.
 */
export interface IpcMetricEntry {
  channel: string;
  durationMs: number;
  payloadBytes: number;
  success: boolean;
  timestamp: number;
}

/**
 * Aggregated metrics summary for a single channel.
 */
export interface ChannelMetricsSummary {
  channel: string;
  callCount: number;
  errorCount: number;
  p50Ms: number;
  p95Ms: number;
  avgPayloadBytes: number;
}

/**
 * Overall metrics summary returned by the metrics endpoint.
 */
export interface MetricsSummary {
  channels: ChannelMetricsSummary[];
  totalCalls: number;
  totalErrors: number;
  uptimeMs: number;
}

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

export interface CashRegisterSalesSummary {
  sale_count: number;
  total_cash_sales: number;
  total_credit_sales: number;
  total_credit_collected: number;
}

export interface AwsConnectionConfig {
  aws_env: string;
  aws_region: string;
  aws_api_base_url: string;
  aws_timeout_ms: string;
  aws_retry_max: string;
}
