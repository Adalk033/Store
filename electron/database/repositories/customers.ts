import { getDatabase } from '../connection';
import type { Customer } from '../../../src/types/database';

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
