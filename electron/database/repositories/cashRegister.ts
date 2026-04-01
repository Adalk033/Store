import { getDatabase } from '../connection';
import type { CashRegisterPeriod, CashMovement, CreditPaymentListItem, SaleListItem, PaginatedQuery, PaginatedResponse, SortSpec, IdempotentResult } from '../../../src/types/database';
import { sanitizePagination, calcLimitOffset, buildLikePattern, isValidDateFilter, isValidStatus, isValidIdempotencyKey } from '../../lib/queryHelpers';
import { incrementVersion } from '../../lib/dataVersions';

export interface CashRegisterSalesSummary {
  sale_count: number;
  total_cash_sales: number;
  total_credit_sales: number;
  total_credit_collected: number;
}

const DEFAULT_SORT: SortSpec = { field: 'created_at', direction: 'DESC' };
const ALLOWED_SALE_TYPES = ['cash', 'credit'] as const;
const ALLOWED_MOVEMENT_TYPES = ['expense', 'withdrawal', 'deposit'] as const;
const ALLOWED_PERIOD_STATUSES = ['open', 'closed'] as const;

export function getCurrentPeriod(): CashRegisterPeriod | undefined {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM cash_register_periods WHERE status = 'open' LIMIT 1"
  ).get() as CashRegisterPeriod | undefined;
}

export function openPeriod(data: { period_name: string; start_date: string; opening_cash: number }): CashRegisterPeriod {
  const db = getDatabase();

  // Atomic check-and-insert in a transaction to prevent race conditions
  const transaction = db.transaction(() => {
    const existing = db.prepare(
      "SELECT id FROM cash_register_periods WHERE status = 'open' LIMIT 1"
    ).get() as { id: number } | undefined;

    if (existing) {
      throw new Error('Ya existe un periodo de caja abierto. Cierre el periodo actual antes de abrir uno nuevo.');
    }

    const result = db.prepare(`
      INSERT INTO cash_register_periods (period_name, start_date, opening_cash, version)
      VALUES (?, ?, ?, 1)
    `).run(data.period_name, data.start_date, data.opening_cash);

    return Number(result.lastInsertRowid);
  });

  const newId = transaction();
  incrementVersion('cash');
  return getPeriodById(newId)!;
}

export function closePeriod(id: number, closingCash: number, endDate: string, expectedVersion?: number): CashRegisterPeriod {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    // Optimistic lock: verify version has not changed since the client fetched the period
    if (typeof expectedVersion === 'number') {
      const current = db.prepare(
        'SELECT version FROM cash_register_periods WHERE id = ? AND status = ?'
      ).get(id, 'open') as { version: number } | undefined;

      if (!current) {
        throw new Error('El periodo de caja no existe o ya fue cerrado.');
      }

      if (current.version !== expectedVersion) {
        throw new Error('El periodo de caja fue modificado por otra operacion. Recargue e intente de nuevo.');
      }
    }

    // Calculate totals from actual data
    const cashSales = db.prepare(
      "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE cash_register_id = ? AND sale_type = 'cash'"
    ).get(id) as { total: number };

    const creditSales = db.prepare(
      "SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE cash_register_id = ? AND sale_type = 'credit'"
    ).get(id) as { total: number };

    const expenses = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM cash_movements WHERE cash_register_id = ? AND type = 'expense'"
    ).get(id) as { total: number };

    const creditCollected = db.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM credit_payments WHERE cash_register_id = ?'
    ).get(id) as { total: number };

    const updateResult = db.prepare(`
      UPDATE cash_register_periods
      SET end_date = ?,
          total_cash_sales = ?,
          total_credit_sales = ?,
          total_credit_collected = ?,
          total_expenses = ?,
          closing_cash = ?,
          status = 'closed',
          version = version + 1
      WHERE id = ? AND status = 'open'
    `).run(endDate, cashSales.total, creditSales.total, creditCollected.total, expenses.total, closingCash, id);

    if (updateResult.changes === 0) {
      throw new Error('El periodo de caja ya fue cerrado por otra operacion.');
    }
  });

  transaction();
  incrementVersion('cash');
  return getPeriodById(id)!;
}

export function getPeriodById(id: number): CashRegisterPeriod | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM cash_register_periods WHERE id = ?').get(id) as CashRegisterPeriod | undefined;
}

export function getAllPeriods(): CashRegisterPeriod[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM cash_register_periods ORDER BY created_at DESC').all() as CashRegisterPeriod[];
}

export function addCashMovement(data: {
  cash_register_id: number;
  type: 'expense' | 'withdrawal' | 'deposit';
  amount: number;
  description?: string | null;
  idempotency_key?: string;
}): IdempotentResult<CashMovement> {
  const db = getDatabase();

  // Idempotency check
  const idempotencyKey = isValidIdempotencyKey(data.idempotency_key) ? data.idempotency_key : null;
  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT id FROM cash_movements WHERE idempotency_key = ?'
    ).get(idempotencyKey) as { id: number } | undefined;
    if (existing) {
      const movement = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(existing.id) as CashMovement;
      return { data: movement, created: false };
    }
  }

  const result = db.prepare(`
    INSERT INTO cash_movements (cash_register_id, type, amount, description, idempotency_key)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.cash_register_id, data.type, data.amount, data.description ?? null, idempotencyKey);

  const movement = db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(
    Number(result.lastInsertRowid)
  ) as CashMovement;

  incrementVersion('cash');
  return { data: movement, created: true };
}

export function getMovementsByPeriod(cashRegisterId: number): CashMovement[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM cash_movements WHERE cash_register_id = ? ORDER BY created_at DESC'
  ).all(cashRegisterId) as CashMovement[];
}

export function getSalesSummaryByPeriod(cashRegisterId: number): CashRegisterSalesSummary {
  const db = getDatabase();

  const row = db.prepare(
    `SELECT
      COUNT(*) AS sale_count,
      COALESCE(SUM(CASE WHEN sale_type = 'cash' THEN total ELSE 0 END), 0) AS total_cash_sales,
      COALESCE(SUM(CASE WHEN sale_type = 'credit' THEN total ELSE 0 END), 0) AS total_credit_sales,
      COALESCE((SELECT SUM(amount) FROM credit_payments WHERE cash_register_id = ?), 0) AS total_credit_collected
    FROM sales
    WHERE cash_register_id = ?`
  ).get(cashRegisterId, cashRegisterId) as CashRegisterSalesSummary | undefined;

  return row ?? { sale_count: 0, total_cash_sales: 0, total_credit_sales: 0, total_credit_collected: 0 };
}

export function getSalesByPeriod(cashRegisterId: number, limit = 200, offset = 0): SaleListItem[] {
  const db = getDatabase();

  return db.prepare(
    `SELECT
      s.*,
      c.name AS customer_name,
      COALESCE(SUM(si.quantity), 0) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE s.cash_register_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?`
  ).all(cashRegisterId, limit, offset) as SaleListItem[];
}

export function getCreditPaymentsByPeriod(cashRegisterId: number, limit = 200, offset = 0): CreditPaymentListItem[] {
  const db = getDatabase();

  return db.prepare(
    `SELECT
      cp.*,
      c.sale_id,
      c.customer_id,
      c.status AS credit_status,
      cu.name AS customer_name
    FROM credit_payments cp
    INNER JOIN credits c ON c.id = cp.credit_id
    LEFT JOIN customers cu ON cu.id = c.customer_id
    WHERE cp.cash_register_id = ?
    ORDER BY cp.created_at DESC
    LIMIT ? OFFSET ?`
  ).all(cashRegisterId, limit, offset) as CreditPaymentListItem[];
}

// --- Paginated endpoints (Phase 1 - Scalability) ---

export function getSalesByPeriodPaginated(
  cashRegisterId: number,
  query: PaginatedQuery
): PaginatedResponse<SaleListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = ['s.cash_register_id = ?'];
  const params: unknown[] = [cashRegisterId];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(c.name) LIKE ? OR CAST(s.id AS TEXT) LIKE ?)');
    params.push(pattern, pattern);
  }

  if (isValidStatus(query.type, ALLOWED_SALE_TYPES)) {
    conditions.push('s.sale_type = ?');
    params.push(query.type);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("s.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("s.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.join(' AND ');

  const countRow = db.prepare(
    `SELECT COUNT(DISTINCT s.id) AS total
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT
      s.*,
      c.name AS customer_name,
      COALESCE(SUM(si.quantity), 0) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    WHERE ${whereClause}
    GROUP BY s.id
    ORDER BY s.${sort.field === 'created_at' ? 'created_at' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, s.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as SaleListItem[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getCreditPaymentsByPeriodPaginated(
  cashRegisterId: number,
  query: PaginatedQuery
): PaginatedResponse<CreditPaymentListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = ['cp.cash_register_id = ?'];
  const params: unknown[] = [cashRegisterId];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(cu.name) LIKE ? OR CAST(cp.id AS TEXT) LIKE ? OR CAST(c.sale_id AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("cp.created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("cp.created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.join(' AND ');

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total
     FROM credit_payments cp
     INNER JOIN credits c ON c.id = cp.credit_id
     LEFT JOIN customers cu ON cu.id = c.customer_id
     WHERE ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT
      cp.*,
      c.sale_id,
      c.customer_id,
      c.status AS credit_status,
      cu.name AS customer_name
    FROM credit_payments cp
    INNER JOIN credits c ON c.id = cp.credit_id
    LEFT JOIN customers cu ON cu.id = c.customer_id
    WHERE ${whereClause}
    ORDER BY cp.${sort.field === 'created_at' ? 'created_at' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, cp.id DESC
    LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CreditPaymentListItem[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getMovementsByPeriodPaginated(
  cashRegisterId: number,
  query: PaginatedQuery
): PaginatedResponse<CashMovement> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = ['cash_register_id = ?'];
  const params: unknown[] = [cashRegisterId];

  if (isValidStatus(query.type, ALLOWED_MOVEMENT_TYPES)) {
    conditions.push('type = ?');
    params.push(query.type);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.join(' AND ');

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total FROM cash_movements WHERE ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT * FROM cash_movements
     WHERE ${whereClause}
     ORDER BY ${sort.field === 'created_at' ? 'created_at' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CashMovement[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getAllPeriodsPaginated(
  query: PaginatedQuery
): PaginatedResponse<CashRegisterPeriod> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (isValidStatus(query.status, ALLOWED_PERIOD_STATUSES)) {
    conditions.push('status = ?');
    params.push(query.status);
  }

  if (isValidDateFilter(query.dateFrom)) {
    conditions.push("created_at >= ? || ' 00:00:00'");
    params.push(query.dateFrom);
  }

  if (isValidDateFilter(query.dateTo)) {
    conditions.push("created_at <= ? || ' 23:59:59'");
    params.push(query.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = db.prepare(
    `SELECT COUNT(*) AS total FROM cash_register_periods ${whereClause}`
  ).get(...params) as { total: number };

  const total = countRow.total;

  const items = db.prepare(
    `SELECT * FROM cash_register_periods
     ${whereClause}
     ORDER BY ${sort.field === 'created_at' ? 'created_at' : 'created_at'} ${sort.direction === 'ASC' ? 'ASC' : 'DESC'}, id DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as CashRegisterPeriod[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}
