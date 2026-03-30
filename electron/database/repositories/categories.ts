import { getDatabase } from '../connection';
import type { Category } from '../../../src/types/database';

export function getAllCategories(): Category[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM categories ORDER BY name').all() as Category[];
}

export function getCategoryById(id: number): Category | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
}

export function createCategory(data: { name: string; parent_id?: number | null }): Category {
  const db = getDatabase();
  const result = db.prepare(
    'INSERT INTO categories (name, parent_id) VALUES (?, ?)'
  ).run(data.name, data.parent_id ?? null);
  return getCategoryById(Number(result.lastInsertRowid))!;
}

export function updateCategory(id: number, data: { name?: string; parent_id?: number | null }): Category | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) {
    fields.push('name = ?');
    values.push(data.name);
  }
  if (data.parent_id !== undefined) {
    fields.push('parent_id = ?');
    values.push(data.parent_id);
  }

  if (fields.length === 0) return getCategoryById(id);

  values.push(id);
  db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getCategoryById(id);
}

export function deleteCategory(id: number): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  return result.changes > 0;
}
