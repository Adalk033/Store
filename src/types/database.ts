// Database entity types matching the SQLite schema

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

// --- Cursor/keyset pagination (Phase 5 - Hardening cloud) ---

/**
 * Cursor for keyset pagination.
 * Encodes the (created_at, id) pair as an opaque string: "created_at|id"
 */
export type CursorToken = string;

/**
 * Request for cursor-based pagination.
 * Use `cursor` to fetch the next page after a known position.
 * On first request, omit `cursor` to start from the beginning.
 */
export interface CursorPaginatedQuery extends QueryFilters {
  pageSize: number;
  cursor?: CursorToken;
  sort?: SortSpec;
}

/**
 * Response for cursor-based pagination.
 * `nextCursor` is null when there are no more results.
 */
export interface CursorPaginatedResponse<T> {
  items: T[];
  pageSize: number;
  nextCursor: CursorToken | null;
  hasMore: boolean;
  sort: SortSpec;
}

// --- Data versioning (Phase 5 - Hardening cloud) ---

/**
 * Tracks the version number per module for cache invalidation.
 * Renderer polls versions and refreshes data only when version changes.
 */
export interface DataVersion {
  module: string;
  version: number;
  updated_at: string;
}

/**
 * Map of module name -> current version number.
 * Returned by the data versions check endpoint.
 */
export type DataVersionMap = Record<string, number>;

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
