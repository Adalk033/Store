import { getDatabase } from '../connection';
import type { Sale, SaleItem } from '../../../src/types/database';

interface CreateSaleData {
  sale_type: 'cash' | 'credit';
  customer_id?: number | null;
  items: Array<{
    product_id: number;
    quantity: number;
    unit_price: number;
  }>;
  cash_register_id?: number | null;
}

export function createSale(data: CreateSaleData): Sale {
  const db = getDatabase();

  const subtotal = data.items.reduce(
    (sum, item) => sum + item.quantity * item.unit_price,
    0
  );

  const transaction = db.transaction(() => {
    // Insert sale
    const saleResult = db.prepare(`
      INSERT INTO sales (sale_type, customer_id, subtotal, surcharge, total, cash_register_id)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(
      data.sale_type,
      data.customer_id ?? null,
      subtotal,
      subtotal,
      data.cash_register_id ?? null
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
      INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes)
      VALUES (?, 'out', ?, ?, 'Venta automatica')
    `);

    for (const item of data.items) {
      insertItem.run(saleId, item.product_id, item.quantity, item.unit_price);
      updateStock.run(item.quantity, item.product_id);
      insertMovement.run(item.product_id, -item.quantity, saleId);
    }

    return saleId;
  });

  const saleId = transaction();
  return getSaleById(saleId)!;
}

export function getSaleById(id: number): Sale | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale | undefined;
}

export function getSaleItems(saleId: number): SaleItem[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as SaleItem[];
}

export function getAllSales(limit = 100, offset = 0): Sale[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM sales ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as Sale[];
}
