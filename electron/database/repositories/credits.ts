import { getDatabase } from '../connection';
import { getSetting } from './settings';
import {
  getBusinessNowDateTime,
  getBusinessTodayDate,
  resolveBusinessTimeZone,
} from '../../lib/time';
import type { Credit, CreditPayment } from '../../../src/types/database';

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

export function addCreditPayment(creditId: number, amount: number): Credit {
  const db = getDatabase();
  const businessTimeZone = resolveBusinessTimeZone(getSetting('business_timezone'));
  const nowDateTime = getBusinessNowDateTime(businessTimeZone);

  const openPeriod = db
    .prepare("SELECT id FROM cash_register_periods WHERE status = 'open' LIMIT 1")
    .get() as { id: number } | undefined;

  if (!openPeriod) {
    throw new Error('No hay un periodo de caja abierto. Abra una caja antes de registrar abonos.');
  }

  const transaction = db.transaction(() => {
    // Insert payment record
    db.prepare(
      'INSERT INTO credit_payments (credit_id, amount, cash_register_id) VALUES (?, ?, ?)'
    ).run(creditId, amount, openPeriod.id);

    // Update credit amount_paid
    db.prepare(
      'UPDATE credits SET amount_paid = amount_paid + ? WHERE id = ?'
    ).run(amount, creditId);

    // Check if fully paid
    const credit = getCreditById(creditId)!;
    if (credit.amount_paid >= credit.total_due) {
      db.prepare(
        "UPDATE credits SET status = 'paid', paid_at = ? WHERE id = ?"
      ).run(nowDateTime, creditId);
    }

    return creditId;
  });

  transaction();
  return getCreditById(creditId)!;
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

  return transaction();
}
