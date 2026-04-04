import { getDatabase } from '../connection';
import type { Product, PaginatedResponse, SortSpec } from '../../../src/types/database';
import { buildLikePattern, sanitizePagination, calcLimitOffset, isValidStatus } from '../../lib/queryHelpers';
import { incrementVersion } from '../../lib/dataVersions';

const ALLOWED_SORT_FIELDS = ['name', 'cost_price', 'sale_price', 'stock', 'created_at', 'updated_at'] as const;
const ALLOWED_STATUS = ['active', 'inactive'] as const;
const DEFAULT_SORT: SortSpec = { field: 'name', direction: 'ASC' };

interface ProductPaginatedQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  categoryId?: number;
  lowStock?: boolean;
  startsWith?: string;
  stockMode?: 'eq' | 'lte' | 'gte';
  stockValue?: number;
  sort?: SortSpec;
}

export function getAllProductsPaginated(query: ProductPaginatedQuery): PaginatedResponse<Product> {
  const db = getDatabase();
  const { page, pageSize } = sanitizePagination(query.page, query.pageSize);

  const sort: SortSpec = (
    query.sort &&
    typeof query.sort.field === 'string' &&
    (ALLOWED_SORT_FIELDS as readonly string[]).includes(query.sort.field) &&
    (query.sort.direction === 'ASC' || query.sort.direction === 'DESC')
  ) ? query.sort : DEFAULT_SORT;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  // Status filter (active/inactive maps to is_active 1/0)
  if (isValidStatus(query.status, ALLOWED_STATUS)) {
    conditions.push('p.is_active = ?');
    params.push(query.status === 'active' ? 1 : 0);
  }

  // Category filter
  if (typeof query.categoryId === 'number' && Number.isInteger(query.categoryId) && query.categoryId >= 1) {
    conditions.push('p.category_id = ?');
    params.push(query.categoryId);
  }

  // Alphabetical filter by first character
  if (typeof query.startsWith === 'string' && query.startsWith) {
    if (query.startsWith === '0-9') {
      conditions.push("SUBSTR(TRIM(COALESCE(p.name, '')), 1, 1) GLOB '[0-9]'");
    } else if (/^[A-Z]$/.test(query.startsWith)) {
      conditions.push("UPPER(COALESCE(p.name, '')) LIKE ? ESCAPE '\\'");
      params.push(`${query.startsWith}%`);
    }
  }

  // Stock number filter
  if (
    (query.stockMode === 'eq' || query.stockMode === 'lte' || query.stockMode === 'gte') &&
    typeof query.stockValue === 'number' &&
    Number.isInteger(query.stockValue) &&
    query.stockValue >= 0
  ) {
    if (query.stockMode === 'eq') {
      conditions.push('p.stock = ?');
    } else if (query.stockMode === 'lte') {
      conditions.push('p.stock <= ?');
    } else {
      conditions.push('p.stock >= ?');
    }
    params.push(query.stockValue);
  }

  // Low stock filter
  if (query.lowStock === true) {
    conditions.push('p.min_stock >= 0 AND p.stock <= p.min_stock AND p.is_active = 1');
  }

  // Text search (name, barcode, description, category name)
  if (typeof query.search === 'string' && query.search.trim()) {
    const pattern = buildLikePattern(query.search);
    conditions.push(`(
      p.name LIKE ? ESCAPE '\\'
      OR p.barcode LIKE ? ESCAPE '\\'
      OR COALESCE(p.description, '') LIKE ? ESCAPE '\\'
      OR COALESCE(c.name, '') LIKE ? ESCAPE '\\'
    )`);
    params.push(pattern, pattern, pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Sort column mapping (prefix with table alias)
  const sortColumn = sort.field === 'name' ? 'p.name' : `p.${sort.field}`;
  const orderClause = `ORDER BY ${sortColumn} ${sort.direction}, p.id DESC`;

  // Count total
  const countRow = db.prepare(`
    SELECT COUNT(*) AS total
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereClause}
  `).get(...params) as { total: number };

  const total = countRow.total;
  const { limit, offset } = calcLimitOffset(page, pageSize);

  const items = db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Product[];

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: offset + items.length < total,
    sort,
  };
}

export function getAllProducts(): Product[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.name
  `).all() as Product[];
}

export function getProductById(id: number): Product | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ?
  `).get(id) as Product | undefined;
}

export function getProductByBarcode(barcode: string): Product | undefined {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.barcode = ?
  `).get(barcode) as Product | undefined;
}

export function searchProducts(query: string): Product[] {
  const db = getDatabase();
  const term = `%${query}%`;
  return db.prepare(
    `SELECT p.*, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE (
       p.name LIKE ?
       OR p.barcode LIKE ?
       OR COALESCE(p.description, '') LIKE ?
       OR COALESCE(c.name, '') LIKE ?
     )
     AND p.is_active = 1
     ORDER BY p.name`
  ).all(term, term, term, term) as Product[];
}

export function getLowStockProducts(): Product[] {
  const db = getDatabase();
  return db.prepare(
    `SELECT p.*, c.name AS category_name
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.min_stock >= 0 AND p.stock <= p.min_stock AND p.is_active = 1
     ORDER BY p.stock ASC`
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
  const product = getProductById(Number(result.lastInsertRowid))!;
  incrementVersion('products');
  return product;
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
  incrementVersion('products');
  return getProductById(id);
}

export function deleteProduct(id: number): boolean {
  const db = getDatabase();
  // Soft delete: mark as inactive
  const result = db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id);
  if (result.changes > 0) incrementVersion('products');
  return result.changes > 0;
}

export function canDeleteProductPermanently(id: number): boolean {
  const db = getDatabase();
  const row = db.prepare(
    `SELECT COUNT(1) AS total
     FROM sale_items
     WHERE product_id = ?`
  ).get(id) as { total: number };

  return row.total === 0;
}

export function deleteProductPermanently(id: number): boolean {
  const db = getDatabase();

  if (!canDeleteProductPermanently(id)) {
    throw new Error('No se puede eliminar permanentemente: el producto tiene ventas asociadas.');
  }

  const result = db.prepare('DELETE FROM products WHERE id = ?').run(id);
  if (result.changes > 0) incrementVersion('products');
  return result.changes > 0;
}
