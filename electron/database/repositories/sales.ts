import { getDatabase } from '../connection';
import type {
  Sale,
  SaleItem,
  SaleDetail,
  SaleDetailItem,
  SaleListItem,
} from '../../../src/types/database';

interface CreateSaleData {
  sale_type: 'cash' | 'credit';
  customer_id?: number | null;
  items: Array<{
    product_id: number;
    quantity: number;
    unit_price: number;
  }>;
  cash_register_id?: number | null;
  // Credit-specific fields (required when sale_type === 'credit')
  credit_days?: number;
  surcharge_percent?: number;
  // Cash-specific fields (used when sale_type === 'cash')
  cash_received?: number;
  cash_change?: number;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createSale(data: CreateSaleData): Sale {
  const db = getDatabase();

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
      INSERT INTO sales (sale_type, customer_id, subtotal, surcharge, total, cash_received, cash_change, cash_register_id)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      data.sale_type,
      data.customer_id ?? null,
      subtotal,
      subtotal,
      cashReceived,
      cashChange,
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

    // Create credit record for credit sales
    if (data.sale_type === 'credit' && data.customer_id) {
      const creditDays = data.credit_days ?? 5;
      const surchargePercent = data.surcharge_percent ?? 0;

      db.prepare(`
        INSERT INTO credits (sale_id, customer_id, original_amount, due_date, surcharge_percent, total_due)
        VALUES (?, ?, ?, date('now', 'localtime', '+' || ? || ' days'), ?, ?)
      `).run(saleId, data.customer_id, subtotal, creditDays, surchargePercent, subtotal);
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
