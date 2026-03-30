import { getDatabase } from '../connection';
import type { Product } from '../../../src/types/database';

export function getAllProducts(): Product[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM products ORDER BY name').all() as Product[];
}

export function getProductById(id: number): Product | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
}

export function getProductByBarcode(barcode: string): Product | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM products WHERE barcode = ?').get(barcode) as Product | undefined;
}

export function searchProducts(query: string): Product[] {
  const db = getDatabase();
  const term = `%${query}%`;
  return db.prepare(
    'SELECT * FROM products WHERE (name LIKE ? OR barcode LIKE ? OR description LIKE ?) AND is_active = 1 ORDER BY name'
  ).all(term, term, term) as Product[];
}

export function getLowStockProducts(): Product[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM products WHERE stock <= min_stock AND is_active = 1 ORDER BY stock ASC'
  ).all() as Product[];
}

interface CreateProductData {
  barcode: string;
  name: string;
  description?: string | null;
  category_id?: number | null;
  cost_price: number;
  margin_percent: number;
  stock?: number;
  min_stock?: number;
}

export function createProduct(data: CreateProductData): Product {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT INTO products (barcode, name, description, category_id, cost_price, margin_percent, stock, min_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.barcode,
    data.name,
    data.description ?? null,
    data.category_id ?? null,
    data.cost_price,
    data.margin_percent,
    data.stock ?? 0,
    data.min_stock ?? 5
  );
  return getProductById(Number(result.lastInsertRowid))!;
}

interface UpdateProductData {
  name?: string;
  description?: string | null;
  category_id?: number | null;
  cost_price?: number;
  margin_percent?: number;
  min_stock?: number;
  is_active?: number;
}

export function updateProduct(id: number, data: UpdateProductData): Product | undefined {
  const db = getDatabase();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
  if (data.description !== undefined) { fields.push('description = ?'); values.push(data.description); }
  if (data.category_id !== undefined) { fields.push('category_id = ?'); values.push(data.category_id); }
  if (data.cost_price !== undefined) { fields.push('cost_price = ?'); values.push(data.cost_price); }
  if (data.margin_percent !== undefined) { fields.push('margin_percent = ?'); values.push(data.margin_percent); }
  if (data.min_stock !== undefined) { fields.push('min_stock = ?'); values.push(data.min_stock); }
  if (data.is_active !== undefined) { fields.push('is_active = ?'); values.push(data.is_active); }

  if (fields.length === 0) return getProductById(id);

  values.push(id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getProductById(id);
}

export function deleteProduct(id: number): boolean {
  const db = getDatabase();
  // Soft delete: mark as inactive
  const result = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
  return result.changes > 0;
}
