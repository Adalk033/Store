import { getDatabase } from '../connection';
import type { InventoryMovement } from '../../../src/types/database';

interface AddMovementData {
  product_id: number;
  type: 'in' | 'out' | 'adjustment';
  quantity: number;
  reference_id?: number | null;
  notes?: string | null;
  cost_price?: number;
  margin_percent?: number;
}

export function addInventoryMovement(data: AddMovementData): InventoryMovement {
  const db = getDatabase();

  const transaction = db.transaction(() => {
    if (data.type === 'in' && (data.cost_price !== undefined || data.margin_percent !== undefined)) {
      if (data.cost_price !== undefined && (!Number.isFinite(data.cost_price) || data.cost_price <= 0)) {
        throw new Error('El precio de costo debe ser mayor a 0');
      }

      if (data.margin_percent !== undefined && (!Number.isFinite(data.margin_percent) || data.margin_percent < 0)) {
        throw new Error('El porcentaje de utilidad no puede ser negativo');
      }

      const priceFields: string[] = [];
      const priceValues: number[] = [];

      if (data.cost_price !== undefined) {
        priceFields.push('cost_price = ?');
        priceValues.push(data.cost_price);
      }

      if (data.margin_percent !== undefined) {
        priceFields.push('margin_percent = ?');
        priceValues.push(data.margin_percent);
      }

      if (priceFields.length > 0) {
        db.prepare(`UPDATE products SET ${priceFields.join(', ')} WHERE id = ?`)
          .run(...priceValues, data.product_id);
      }
    }

    const result = db.prepare(`
      INSERT INTO inventory_movements (product_id, type, quantity, reference_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      data.product_id,
      data.type,
      data.quantity,
      data.reference_id ?? null,
      data.notes ?? null
    );

    // Update product stock based on movement type
    if (data.type === 'in') {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
        .run(Math.abs(data.quantity), data.product_id);
    } else if (data.type === 'out') {
      db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
        .run(Math.abs(data.quantity), data.product_id);
    } else {
      // adjustment: quantity is the new absolute value to set
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
        .run(data.quantity, data.product_id);
    }

    return Number(result.lastInsertRowid);
  });

  const id = transaction();
  return getMovementById(id)!;
}

export function getMovementById(id: number): InventoryMovement | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM inventory_movements WHERE id = ?').get(id) as InventoryMovement | undefined;
}

export function getMovementsByProduct(productId: number): InventoryMovement[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM inventory_movements WHERE product_id = ? ORDER BY created_at DESC'
  ).all(productId) as InventoryMovement[];
}

export function getAllMovements(limit = 100, offset = 0): InventoryMovement[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM inventory_movements ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset) as InventoryMovement[];
}
