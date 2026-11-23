import { getCalendarDate } from '../../src/lib/formatters.ts';
import type { PeriodCorrection, SaleTransfer } from '../../src/types/database';

export function validId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
    value < 1e10 && Number(value.toFixed(2)) === value;
}

export function validDate(value: unknown): value is string {
  return typeof value === 'string' && value.length === 10 && getCalendarDate(value) === value;
}

function fields(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Datos inválidos');
  return value as Record<string, unknown>;
}

export function validateCorrection(input: unknown): PeriodCorrection {
  const { id, version, start_date, end_date, opening_cash, closing_cash } = fields(input);
  if (!validId(id) || !validId(version) || !validDate(start_date) || !validDate(end_date) ||
      end_date < start_date || !validAmount(opening_cash) || !validAmount(closing_cash))
    throw new Error('Revisa las fechas y los importes de la caja');
  return { id, version, start_date, end_date, opening_cash, closing_cash };
}

export function validateTransfer(input: unknown): SaleTransfer {
  const { sale_id, source_id, target_id, source_version, target_version, sale_date } = fields(input);
  if (!validId(sale_id) || !validId(source_id) || !validId(target_id) || source_id === target_id ||
      !validId(source_version) || !validId(target_version) || !validDate(sale_date))
    throw new Error('Revisa la venta, las cajas y la fecha del traslado');
  return { sale_id, source_id, target_id, source_version, target_version, sale_date };
}

export function validateSale(input: unknown): void {
  const data = fields(input);
  if (!['cash', 'credit'].includes(String(data.sale_type)) || !Array.isArray(data.items) || !data.items.length ||
      (data.cash_register_id != null && !validId(data.cash_register_id)) ||
      (data.sale_date !== undefined && !validDate(data.sale_date)) ||
      (data.customer_id != null && !validId(data.customer_id)) ||
      (data.sale_type === 'credit' && !validId(data.customer_id)) ||
      (data.credit_days !== undefined && !validId(data.credit_days)) ||
      (data.idempotency_key !== undefined && (typeof data.idempotency_key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.idempotency_key))) ||
      ['initial_payment','surcharge_percent','cash_received','cash_change'].some(key => data[key] !== undefined && !validAmount(data[key])))
    throw new Error('Datos de venta inválidos');
  for (const raw of data.items) {
    const item = fields(raw);
    if (!validId(item.product_id) || typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) ||
        item.quantity <= 0 || item.quantity >= 1e9 || Number(item.quantity.toFixed(3)) !== item.quantity || !validAmount(item.unit_price))
      throw new Error('Producto, cantidad o precio inválido');
  }
}
