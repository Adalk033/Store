import { getDatabase } from '../connection';
import { getSetting } from './settings';
import {
  addDaysToDate,
  extractDatePart,
  getBusinessNowDateTime,
  resolveBusinessTimeZone,
} from '../../lib/time';
import type {
  Sale,
  SaleItem,
  SaleDetail,
  SaleDetailItem,
  SaleListItem,
  PaginatedQuery,
  PaginatedResponse,
  SortSpec,
  CursorPaginatedQuery,
  CursorPaginatedResponse,
  IdempotentResult,
} from '../../../src/types/database';
import {
  sanitizePagination,
  calcLimitOffset,
  buildLikePattern,
  isValidDateFilter,
  isValidStatus,
  sanitizeCursorPagination,
  buildCursorWhereDesc,
  encodeCursor,
  isValidIdempotencyKey,
} from '../../lib/queryHelpers';
import { incrementVersion } from '../../lib/dataVersions';

interface CreateSaleData {
  sale_type: 'cash' | 'credit';
  customer_id?: number | null;
  sale_date?: string;
  items: Array<{
    product_id: number;
    quantity: number;
    unit_price: number;
  }>;
  cash_register_id?: number | null;
  // Credit-specific fields (required when sale_type === 'credit')
  credit_days?: number;
  surcharge_percent?: number;
  initial_payment?: number;
  // Cash-specific fields (used when sale_type === 'cash')
  cash_received?: number;
  cash_change?: number;
  // Idempotency (Phase 5)
  idempotency_key?: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidDateString(dateValue: string): boolean {
  const [year, month, day] = dateValue.split('-').map(Number);
  const selectedDate = new Date(year, month - 1, day, 0, 0, 0, 0);

  return (
    !Number.isNaN(selectedDate.getTime()) &&
    selectedDate.getFullYear() === year &&
    selectedDate.getMonth() === month - 1 &&
    selectedDate.getDate() === day
  );
}

function resolveSaleCreatedAt(saleDate: string | undefined, businessTimeZone: string): string {
  const nowLocalDateTime = getBusinessNowDateTime(businessTimeZone);
  const todayLocalDate = extractDatePart(nowLocalDateTime);

  if (!saleDate) {
    return nowLocalDateTime;
  }

  const trimmedDate = saleDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new Error('La fecha de la venta no tiene un formato valido');
  }

  if (!isValidDateString(trimmedDate)) {
    throw new Error('La fecha de la venta no es valida');
  }

  if (trimmedDate > todayLocalDate) {
    throw new Error('No se permiten fechas futuras para la venta');
  }

  if (trimmedDate === todayLocalDate) {
    return nowLocalDateTime;
  }

  return `${trimmedDate} 00:00:00`;
}

export function createSale(data: CreateSaleData): IdempotentResult<Sale> {
  const db = getDatabase();
  const businessTimeZone = resolveBusinessTimeZone(getSetting('business_timezone'));
  const saleCreatedAt = resolveSaleCreatedAt(data.sale_date, businessTimeZone);

  // Idempotency check: return existing sale if same key was already processed
  const idempotencyKey = isValidIdempotencyKey(data.idempotency_key) ? data.idempotency_key : null;
  if (idempotencyKey) {
    const existing = db.prepare(
      'SELECT id FROM sales WHERE idempotency_key = ?'
    ).get(idempotencyKey) as { id: number } | undefined;
    if (existing) {
      return { data: getSaleById(existing.id)!, created: false };
    }
  }

  const openPeriod = db
    .prepare("SELECT id FROM cash_register_periods WHERE status = 'open' LIMIT 1")
    .get() as { id: number } | undefined;

  if (!openPeriod) {
    throw new Error('No hay un periodo de caja abierto. Abra una caja antes de registrar ventas.');
  }

  if (data.cash_register_id != null && data.cash_register_id !== openPeriod.id) {
    throw new Error('La venta debe registrarse en el periodo de caja abierto actualmente.');
  }

  const cashRegisterId = openPeriod.id;

  const subtotal = data.items.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0
  );

  let cashReceived: number | null = null;
  let cashChange: number | null = null;

  if (data.sale_type === 'cash') {
    const received = roundMoney(data.cash_received ?? subtotal);
    const change = roundMoney(data.cash_change ?? received - subtotal);

    if (received < subtotal) {
      throw new Error('El efectivo recibido no puede ser menor al total de la venta');
    }

    if (change < 0) {
      throw new Error('El cambio no puede ser negativo');
    }

    const expectedChange = roundMoney(received - subtotal);
    if (Math.abs(expectedChange - change) > 0.01) {
      throw new Error('Los datos de efectivo y cambio no coinciden con el total');
    }

    cashReceived = received;
    cashChange = change;
  }

  const transaction = db.transaction(() => {
    // Insert sale
    const saleResult = db.prepare(`
      INSERT INTO sales (sale_type, customer_id, subtotal, surcharge, total, cash_received, cash_change, cash_register_id, created_at, idempotency_key)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      data.sale_type,
      data.customer_id ?? null,
      subtotal,
      subtotal,
      cashReceived,
      cashChange,
      cashRegisterId,
      saleCreatedAt,
      idempotencyKey
    );

    const saleId = Number(saleResult.lastInsertRowid);

    // Insert sale items
    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
      VALUES (?, ?, ?, ?)
    `);

    // Update stock and create inventory movement
    const updateStock = db.prepare(
      'UPDATE products SET stock = stock - ? WHERE id = ?'
    );
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes, created_at)
      VALUES (?, 'out', ?, ?, 'Venta automatica', ?)
    `);

    for (const item of data.items) {
      insertItem.run(saleId, item.product_id, item.quantity, item.unit_price);
      updateStock.run(item.quantity, item.product_id);
      insertMovement.run(item.product_id, -item.quantity, saleId, saleCreatedAt);
    }

    // Create credit record for credit sales
    if (data.sale_type === 'credit' && data.customer_id) {
      const creditDays = data.credit_days ?? 5;
      const surchargePercent = data.surcharge_percent ?? 0;
      const initialPayment = roundMoney(data.initial_payment ?? 0);
      const dueDate = addDaysToDate(extractDatePart(saleCreatedAt), creditDays);

      if (initialPayment < 0) {
        throw new Error('El abono inicial no puede ser negativo');
      }

      if (initialPayment > subtotal) {
        throw new Error('El abono inicial no puede ser mayor al total de la venta');
      }

      const status = initialPayment >= subtotal ? 'paid' : 'pending';

      const creditResult = db.prepare(`
        INSERT INTO credits (
          sale_id,
          customer_id,
          original_amount,
          due_date,
          surcharge_percent,
          total_due,
          amount_paid,
          status,
          paid_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'paid' THEN ? ELSE NULL END, ?)
      `).run(
        saleId,
        data.customer_id,
        subtotal,
        dueDate,
        surchargePercent,
        subtotal,
        initialPayment,
        status,
        status,
        saleCreatedAt,
        saleCreatedAt
      );

      if (initialPayment > 0) {
        const creditId = Number(creditResult.lastInsertRowid);
        db.prepare(
          'INSERT INTO credit_payments (credit_id, amount, cash_register_id, created_at) VALUES (?, ?, ?, ?)'
        ).run(creditId, initialPayment, cashRegisterId, saleCreatedAt);
      }
    }

    return saleId;
  });

  const saleId = transaction();
  incrementVersion('sales');
  incrementVersion('inventory');
  return { data: getSaleById(saleId)!, created: true };
}

export function getSaleById(id: number): Sale | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale | undefined;
}

export function getSaleItems(saleId: number): SaleItem[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as SaleItem[];
}

export function getAllSales(limit = 100, offset = 0): SaleListItem[] {
  const db = getDatabase();
  return db.prepare(
    `SELECT
      s.*,
      c.name AS customer_name,
      COALESCE(SUM(si.quantity), 0) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT ? OFFSET ?`
  ).all(limit, offset) as SaleListItem[];
}

// --- Paginated endpoints (Phase 2 - Scalability) ---

const DEFAULT_SORT: SortSpec = { field: 'created_at', direction: 'DESC' };
const ALLOWED_SALE_TYPES = ['cash', 'credit'] as const;

export function getAllSalesPaginated(
  query: PaginatedQuery
): PaginatedResponse<SaleListItem> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);
  const { limit, offset } = calcLimitOffset(page, pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(c.name) LIKE ? OR CAST(s.id AS TEXT) LIKE ? OR CAST(s.total AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
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

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countRow = db.prepare(
    `SELECT COUNT(DISTINCT s.id) AS total
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     ${whereClause}`
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
    ${whereClause}
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

export function getSalesSummary(query: {
  search?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
}): { totalSales: number; totalRevenue: number; cashRevenue: number; creditRevenue: number } {
  const db = getDatabase();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(c.name) LIKE ? OR CAST(s.id AS TEXT) LIKE ? OR CAST(s.total AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
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

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const row = db.prepare(
    `SELECT
      COUNT(*) AS totalSales,
      COALESCE(SUM(s.total), 0) AS totalRevenue,
      COALESCE(SUM(CASE WHEN s.sale_type = 'cash' THEN s.total ELSE 0 END), 0) AS cashRevenue,
      COALESCE(SUM(CASE WHEN s.sale_type = 'credit' THEN s.total ELSE 0 END), 0) AS creditRevenue
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${whereClause}`
  ).get(...params) as { totalSales: number; totalRevenue: number; cashRevenue: number; creditRevenue: number };

  return row;
}

export function getSaleDetailById(id: number): SaleDetail | undefined {
  const db = getDatabase();

  const sale = db.prepare(
    `SELECT
      s.*,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.email AS customer_email
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?`
  ).get(id) as Omit<SaleDetail, 'items'> | undefined;

  if (!sale) {
    return undefined;
  }

  const items = db.prepare(
    `SELECT
      si.*,
      COALESCE(p.name, 'Producto eliminado') AS product_name,
      COALESCE(p.barcode, '') AS product_barcode
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
    ORDER BY si.id ASC`
  ).all(id) as SaleDetailItem[];

  return {
    ...sale,
    items,
  };
}

export function deleteSale(id: number): boolean {
  const db = getDatabase();
  const sale = getSaleById(id);

  if (!sale) {
    throw new Error('La venta no existe');
  }

  const saleItems = getSaleItems(id);

  const transaction = db.transaction(() => {
    const movementCreatedAt = getBusinessNowDateTime(resolveBusinessTimeZone(getSetting('business_timezone')));
    const updateStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
    const insertMovement = db.prepare(`
      INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes, created_at)
      VALUES (?, 'in', ?, ?, 'Reversion por eliminacion de venta', ?)
    `);

    for (const item of saleItems) {
      updateStock.run(item.quantity, item.product_id);
      insertMovement.run(item.product_id, item.quantity, id, movementCreatedAt);
    }

    db.prepare(`
      DELETE FROM credit_payments
      WHERE credit_id IN (SELECT id FROM credits WHERE sale_id = ?)
    `).run(id);

    db.prepare('DELETE FROM credits WHERE sale_id = ?').run(id);

    const result = db.prepare('DELETE FROM sales WHERE id = ?').run(id);
    return result.changes > 0;
  });

  const deleted = transaction();
  if (deleted) {
    incrementVersion('sales');
    incrementVersion('inventory');
    incrementVersion('credits');
  }
  return deleted;
}

// --- Cursor/keyset paginated endpoint (Phase 5 - Hardening cloud) ---

export function getAllSalesCursor(
  query: CursorPaginatedQuery
): CursorPaginatedResponse<SaleListItem> {
  const db = getDatabase();
  const pageSize = sanitizeCursorPagination(query.pageSize);
  const sort: SortSpec = query.sort ?? DEFAULT_SORT;

  const conditions: string[] = [];
  const params: unknown[] = [];

  // Cursor keyset condition
  const cursorWhere = buildCursorWhereDesc(query.cursor, 's');
  if (cursorWhere.sql) {
    conditions.push(cursorWhere.sql);
    params.push(...cursorWhere.params);
  }

  if (query.search && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push('(LOWER(c.name) LIKE ? OR CAST(s.id AS TEXT) LIKE ? OR CAST(s.total AS TEXT) LIKE ?)');
    params.push(pattern, pattern, pattern);
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

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  // Fetch one extra to determine hasMore
  const items = db.prepare(
    `SELECT
      s.*,
      c.name AS customer_name,
      COALESCE(SUM(si.quantity), 0) AS item_count
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sale_items si ON si.sale_id = s.id
    ${whereClause}
    GROUP BY s.id
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT ?`
  ).all(...params, pageSize + 1) as SaleListItem[];

  const hasMore = items.length > pageSize;
  if (hasMore) items.pop();

  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem
    ? encodeCursor(lastItem.created_at, lastItem.id)
    : null;

  return {
    items,
    pageSize,
    nextCursor,
    hasMore,
    sort,
  };
}
