import { getDatabase } from '../connection';
import type { CashRegisterPeriod, CashMovement } from '../../../src/types/database';

export function getCurrentPeriod(): CashRegisterPeriod | undefined {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM cash_register_periods WHERE status = 'open' LIMIT 1"
  ).get() as CashRegisterPeriod | undefined;
}

export function openPeriod(data: { period_name: string; start_date: string; opening_cash: number }): CashRegisterPeriod {
  const db = getDatabase();

  // Ensure no other period is open
  const existing = getCurrentPeriod();
  if (existing) {
    throw new Error('Ya existe un periodo de caja abierto. Cierre el periodo actual antes de abrir uno nuevo.');
  }

  const result = db.prepare(`
    INSERT INTO cash_register_periods (period_name, start_date, opening_cash)
    VALUES (?, ?, ?)
  `).run(data.period_name, data.start_date, data.opening_cash);

  return getPeriodById(Number(result.lastInsertRowid))!;
}

export function closePeriod(id: number, closingCash: number, endDate: string): CashRegisterPeriod {
  const db = getDatabase();

  const transaction = db.transaction(() => {
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

    db.prepare(`
      UPDATE cash_register_periods
      SET end_date = ?,
          total_cash_sales = ?,
          total_credit_sales = ?,
          total_expenses = ?,
          closing_cash = ?,
          status = 'closed'
      WHERE id = ?
    `).run(endDate, cashSales.total, creditSales.total, expenses.total, closingCash, id);
  });

  transaction();
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
}): CashMovement {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO cash_movements (cash_register_id, type, amount, description)
    VALUES (?, ?, ?, ?)
  `).run(data.cash_register_id, data.type, data.amount, data.description ?? null);

  return db.prepare('SELECT * FROM cash_movements WHERE id = ?').get(
    Number(result.lastInsertRowid)
  ) as CashMovement;
}

export function getMovementsByPeriod(cashRegisterId: number): CashMovement[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM cash_movements WHERE cash_register_id = ? ORDER BY created_at DESC'
  ).all(cashRegisterId) as CashMovement[];
}
