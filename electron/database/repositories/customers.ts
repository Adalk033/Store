import { getDatabase } from '../connection';
import {
  sanitizePagination,
  calcLimitOffset,
  buildLikePattern,
  isValidStatus,
} from '../../lib/queryHelpers';
import type {
  Customer,
  CustomerListItem,
  PaginatedQuery,
  PaginatedResponse,
  SortSpec,
} from '../../../src/types/database';

export function getAllCustomers(): Customer[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM customers WHERE is_active = 1 ORDER BY name').all() as Customer[];
}

export function getCustomerById(id: number): Customer | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
}

interface CreateCustomerData {
  name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

export function createCustomer(data: CreateCustomerData): Customer {
  const db = getDatabase();
  const result = db.prepare(
    'INSERT INTO customers (name, phone, email, notes) VALUES (?, ?, ?, ?)'
  ).run(data.name, data.phone ?? null, data.email ?? null, data.notes ?? null);
  return getCustomerById(Number(result.lastInsertRowid))!;
}

interface UpdateCustomerData {
  name?: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  is_active?: number;
}

export function updateCustomer(id: number, data: UpdateCustomerData): Customer | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.phone !== undefined) { fields.push('phone = ?'); values.push(data.phone); }
  if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email); }
  if (data.notes !== undefined) { fields.push('notes = ?'); values.push(data.notes); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active); }

  if (fields.length === 0) return getCustomerById(id);

  values.push(id);
  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCustomerById(id);
}

export function deleteCustomer(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('UPDATE customers SET is_active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}

// --- Paginated endpoints (Phase 3) ---

const DEFAULT_SORT: SortSpec = { field: 'name', direction: 'ASC' };
const ALLOWED_ACTIVE_STATUSES = ['active', 'inactive'] as const;

export function getAllCustomersPaginated(
  query: PaginatedQuery
): PaginatedResponse<CustomerListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Status filter: 'active' -> is_active=1, 'inactive' -> is_active=0; default: show active only
  if (isValidStatus(query.status, ALLOWED_ACTIVE_STATUSES)) {
    conditions.push('c.is_active = ?');
    params.push(query.status === 'active' ? 1 : 0);
  } else {
    conditions.push('c.is_active = 1');
  }

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.phone, \'\')) LIKE ? OR LOWER(COALESCE(c.email, \'\')) LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total
     FROM customers c
     ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT
      c.*,
      COALESCE(cs.total_credits, 0) AS total_credits,
      COALESCE(cs.active_credits, 0) AS active_credits,
      COALESCE(cs.overdue_credits, 0) AS overdue_credits,
      COALESCE(cs.total_debt, 0) AS total_debt,
      COALESCE(cs.total_paid, 0) AS total_paid,
      cs.last_credit_date
    FROM customers c
    LEFT JOIN (
      SELECT
        customer_id,
        COUNT(*) AS total_credits,
        SUM(CASE WHEN status != 'paid' THEN 1 ELSE 0 END) AS active_credits,
        SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdue_credits,
        SUM(CASE WHEN status != 'paid' THEN total_due - amount_paid ELSE 0 END) AS total_debt,
        SUM(amount_paid) AS total_paid,
        MAX(created_at) AS last_credit_date
      FROM credits
      GROUP BY customer_id
    ) cs ON cs.customer_id = c.id
    ${whereClause}
    ORDER BY c.${sort.field === 'name' ? 'name' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, c.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CustomerListItem[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}
