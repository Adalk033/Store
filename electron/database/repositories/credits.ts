import { getDatabase } from '../connection';
import { getSetting } from './settings';
import {
  getBusinessNowDateTime,
  getBusinessTodayDate,
  resolveBusinessTimeZone,
} from '../../lib/time';
import {
  sanitizePagination,
  calcLimitOffset,
  buildLikePattern,
  isValidDateFilter,
  isValidStatus,
  isValidIdempotencyKey,
} from '../../lib/queryHelpers';
import type {
  Credit,
  CreditPayment,
  CreditListItem,
  CreditsSummary,
  PaginatedQuery,
  PaginatedResponse,
  SortSpec,
  IdempotentResult,
} from '../../../src/types/database';
import { incrementVersion } from '../../lib/dataVersions';

export function getAllCredits(status?: string): Credit[] {
  const db = getDatabase();
  if (status) {
    return db.prepare('SELECT * FROM credits WHERE status = ? ORDER BY due_date ASC').all(status) as Credit[];
  }
  return db.prepare('SELECT * FROM credits ORDER BY due_date ASC').all() as Credit[];
}

export function getCreditsByCustomer(customerId: number): Credit[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM credits WHERE customer_id = ? ORDER BY created_at DESC'
  ).all(customerId) as Credit[];
}

export function getCreditById(id: number): Credit | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM credits WHERE id = ?').get(id) as Credit | undefined;
}

function resolvePaymentCreatedAt(paymentDate: string | undefined, businessTimeZone: string): string {
  const todayDate = getBusinessTodayDate(businessTimeZone);

  if (!paymentDate || paymentDate.trim() === '') {
    return getBusinessNowDateTime(businessTimeZone);
  }

  const trimmedDate = paymentDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new Error('La fecha del abono no tiene un formato valido');
  }

  const [year, month, day] = trimmedDate.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day, 0, 0, 0, 0);
  const isValidDate =
    !Number.isNaN(selectedDate.getTime())
    && selectedDate.getFullYear() === year
    && selectedDate.getMonth() === month - 1
    && selectedDate.getDate() === day;

  if (!isValidDate) {
    throw new Error('La fecha del abono no es valida');
  }

  if (trimmedDate > todayDate) {
    throw new Error('No se permiten fechas futuras para el abono');
  }

  if (trimmedDate === todayDate) {
    return getBusinessNowDateTime(businessTimeZone);
  }

  return `${trimmedDate} 00:00:00`;
}

export function addCreditPayment(
  creditId: number,
  amount: number,
  paymentDate?: string,
  idempotencyKeyInput?: string,
): IdempotentResult<Credit> {
  const db = getDatabase();
  const businessTimeZone = resolveBusinessTimeZone(getSetting('business_timezone'));
  const paymentCreatedAt = resolvePaymentCreatedAt(paymentDate, businessTimeZone);

  // Idempotency check: return existing credit state if same key was already processed
  const idempotencyKey = isValidIdempotencyKey(idempotencyKeyInput) ? idempotencyKeyInput : null;
  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT credit_id FROM credit_payments WHERE idempotency_key = ?'
    ).get(idempotencyKey) as { credit_id: number } | undefined;
    if (existing) {
      return { data: getCreditById(existing.credit_id)!, created: false };
    }
  }

  const openPeriod = db
    .prepare("SELECT id FROM cash_register_periods WHERE status = 'open' LIMIT 1")
    .get() as { id: number } | undefined;

  if (!openPeriod) {
    throw new Error('No hay un periodo de caja abierto. Abra una caja antes de registrar abonos.');
  }

  const transaction = db.transaction(() => {
    // Insert payment record
    db.prepare(
      'INSERT INTO credit_payments (credit_id, amount, cash_register_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(creditId, amount, openPeriod.id, idempotencyKey, paymentCreatedAt);

    // Update credit amount_paid
    db.prepare(
      'UPDATE credits SET amount_paid = amount_paid + ? WHERE id = ?'
    ).run(amount, creditId);

    // Check if fully paid
    const credit = getCreditById(creditId)!;
    if (credit.amount_paid >= credit.total_due) {
      db.prepare(
        "UPDATE credits SET status = 'paid', paid_at = ? WHERE id = ?"
      ).run(paymentCreatedAt, creditId);
    }

    return creditId;
  });

  transaction();
  incrementVersion('credits');
  return { data: getCreditById(creditId)!, created: true };
}

export function getCreditPayments(creditId: number): CreditPayment[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM credit_payments WHERE credit_id = ? ORDER BY created_at DESC'
  ).all(creditId) as CreditPayment[];
}

// Check and apply surcharges to overdue credits
export function checkOverdueCredits(): number {
  const db = getDatabase();
  const businessTimeZone = resolveBusinessTimeZone(getSetting('business_timezone'));
  const todayDate = getBusinessTodayDate(businessTimeZone);

  const overdueCredits = db.prepare(`
    SELECT * FROM credits
    WHERE status = 'pending'
      AND surcharge_applied = 0
      AND due_date < ?
  `).all(todayDate) as Credit[];

  const updateCredit = db.prepare(`
    UPDATE credits
    SET total_due = ROUND(original_amount * (1 + surcharge_percent / 100.0), 2),
        surcharge_applied = 1,
        status = 'overdue'
    WHERE id = ?
  `);

  const updateSale = db.prepare(`
    UPDATE sales
    SET surcharge = ROUND(
          (SELECT original_amount FROM credits WHERE sale_id = sales.id) *
          (SELECT surcharge_percent FROM credits WHERE sale_id = sales.id) / 100.0, 2),
        total = subtotal + ROUND(
          (SELECT original_amount FROM credits WHERE sale_id = sales.id) *
          (SELECT surcharge_percent FROM credits WHERE sale_id = sales.id) / 100.0, 2)
    WHERE id = ?
  `);

  const transaction = db.transaction(() => {
    for (const credit of overdueCredits) {
      updateCredit.run(credit.id);
      updateSale.run(credit.sale_id);
    }
    return overdueCredits.length;
  });

  const count = transaction();
  if (count > 0) {
    incrementVersion('credits');
    incrementVersion('sales');
  }
  return count;
}

// --- Paginated endpoints (Phase 3) ---

const DEFAULT_SORT: SortSpec = { field: 'created_at', direction: 'DESC' };
const ALLOWED_CREDIT_STATUSES = ['pending', 'overdue', 'paid'] as const;

export function getAllCreditsPaginated(
  query: PaginatedQuery
): PaginatedResponse<CreditListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(cu.name) LIKE ? OR CAST(cr.id AS TEXT) LIKE ? OR CAST(cr.sale_id AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  if (isValidStatus(query.status, ALLOWED_CREDIT_STATUSES)) {
    conditions.push('cr.status = ?');
    params.push(query.status);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("cr.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("cr.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total
     FROM credits cr
     LEFT JOIN customers cu ON cu.id = cr.customer_id
     ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT
      cr.*,
      cu.name AS customer_name
    FROM credits cr
    LEFT JOIN customers cu ON cu.id = cr.customer_id
    ${whereClause}
    ORDER BY cr.${sort.field === 'due_date' ? 'due_date' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, cr.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CreditListItem[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getCreditsByCustomerPaginated(
  customerId: number,
  query: PaginatedQuery
): PaginatedResponse<CreditListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = ['cr.customer_id = ?'];
  const params: unknown[] = [customerId];

  if (isValidStatus(query.status, ALLOWED_CREDIT_STATUSES)) {
    conditions.push('cr.status = ?');
    params.push(query.status);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("cr.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("cr.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total
     FROM credits cr
     ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT
      cr.*,
      cu.name AS customer_name
    FROM credits cr
    LEFT JOIN customers cu ON cu.id = cr.customer_id
    ${whereClause}
    ORDER BY cr.${sort.field === 'due_date' ? 'due_date' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, cr.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CreditListItem[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getCreditPaymentsPaginated(
  creditId: number,
  query: PaginatedQuery
): PaginatedResponse<CreditPayment> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = ['cp.credit_id = ?'];
  const params: unknown[] = [creditId];

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("cp.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("cp.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total
     FROM credit_payments cp
     ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT cp.*
    FROM credit_payments cp
    ${whereClause}
    ORDER BY cp.created_at ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, cp.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CreditPayment[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getCreditsSummary(query: {
  search?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}): CreditsSummary {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(cu.name) LIKE ? OR CAST(cr.id AS TEXT) LIKE ? OR CAST(cr.sale_id AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("cr.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("cr.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const row = db.prepare(
    `SELECT
      COALESCE(SUM(CASE WHEN cr.status != 'paid' THEN 1 ELSE 0 END), 0) AS countActive,
      COALESCE(SUM(CASE WHEN cr.status = 'pending' THEN cr.total_due - cr.amount_paid ELSE 0 END), 0) AS totalPending,
      COALESCE(SUM(CASE WHEN cr.status = 'overdue' THEN cr.total_due - cr.amount_paid ELSE 0 END), 0) AS totalOverdue,
      COALESCE(SUM(CASE WHEN cr.status = 'paid' THEN cr.total_due ELSE 0 END), 0) AS totalCollected
    FROM credits cr
    LEFT JOIN customers cu ON cu.id = cr.customer_id
    ${whereClause}`
  ).get(...params) as CreditsSummary;

  return row;
}
