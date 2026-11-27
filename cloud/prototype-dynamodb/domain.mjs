import { createHash } from 'node:crypto';

export class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function requireThat(condition, status, message) {
  if (!condition) throw new RequestError(status, message);
}

export function number(value, min = 0, max = 1e9, precision = 2) {
  const numeric = typeof value === 'string' && value.trim() ? Number(value) : value;
  const scale = 10 ** precision;
  requireThat(typeof numeric === 'number' && Number.isFinite(numeric) && numeric >= min && numeric <= max
    && Math.abs(numeric * scale - Math.round(numeric * scale)) < 0.0001, 422, 'Cantidad o importe inválido');
  return Math.round(numeric * scale) / scale;
}

export function text(value, max = 255, optional = false) {
  if (optional && (value == null || (typeof value === 'string' && !value.trim()))) return null;
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 422, 'Texto inválido');
  return value.trim();
}

export function enumOf(value, allowed) {
  requireThat(allowed.includes(value), 422, 'Valor inválido');
  return value;
}

function identifier(value) {
  return number(value, 1, Number.MAX_SAFE_INTEGER, 0);
}

function date(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 422, 'Fecha inválida');
  const timestamp = new Date(value);
  requireThat(Number.isFinite(timestamp.getTime()) && timestamp.toISOString().slice(0, 10) === value, 422, 'Fecha inválida');
  return value;
}

function shiftDays(day, days) {
  const timestamp = new Date(day + 'T12:00:00Z');
  timestamp.setUTCDate(timestamp.getUTCDate() + days);
  return timestamp.toISOString().slice(0, 10);
}

function timeOnDate(day, clock, zone) {
  const desired = Date.parse(day + 'T' + clock + 'Z');
  let candidate = desired;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = formatter.format(new Date(candidate)).replace(' ', 'T');
    const adjustment = desired - Date.parse(local + 'Z');
    if (!adjustment) return new Date(candidate).toISOString();
    candidate += adjustment;
  }
  throw new RequestError(422, 'Hora inválida en la zona del negocio');
}

function settingsValue(rows, key, fallback) {
  return rows.settings.find(row => row.key === key)?.value || fallback;
}

export function context(state, body, now) {
  const { rows, counters } = state;
  const reversedSales = state.reversedSales ??= [];
  const zone = settingsValue(rows, 'business_timezone', settingsValue(rows, 'business_time_zone', 'America/Mexico_City'));
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const businessDay = value => formatter.format(new Date(value));
  const today = businessDay(now);
  function effectiveDay(value) {
    if (value == null) return today;
    const day = date(value);
    requireThat(day <= today, 422, 'La fecha no puede ser futura');
    return day;
  }
  function timestamp(value) {
    return value == null ? now : timeOnDate(effectiveDay(value), '12:00:00', zone);
  }
  function add(table, entry) {
    const id = (counters[table] ?? 0) + 1;
    counters[table] = id;
    const row = { id, ...entry };
    rows[table].push(row);
    return row;
  }
  return { rows, reversedSales, body, now, zone, today, businessDay, effectiveDay, timestamp, add };
}

export function find(rows, table, id) {
  return rows[table].find(row => row.id === id);
}

function get(rows, table, value) {
  const row = find(rows, table, identifier(value));
  requireThat(row, 404, 'Registro no encontrado');
  return row;
}

function drop(rows, table, predicate) {
  rows[table] = rows[table].filter(row => !predicate(row));
}

function keyOf(value) {
  if (value == null) return null;
  requireThat(typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value), 422, 'Identificador de operación inválido');
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonical(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

export function sum(rows, field) {
  return rows.reduce((total, row) => total + Math.round(row[field] * 100), 0) / 100;
}

export function openCash(rows) {
  return rows.cash_register_periods.find(row => row.status === 'open');
}

function requireOpen(rows) {
  const cash = openCash(rows);
  requireThat(cash, 409, 'Abre un periodo de caja antes de continuar');
  return cash;
}

function checkPeriod(cash, day) {
  requireThat(day >= cash.start_date && (!cash.end_date || day <= cash.end_date), 409, 'Fecha fuera del periodo de caja');
}

function saleTotal(cashId, rows, type) {
  return sum(rows.sales.filter(row => row.cash_register_id === cashId && row.sale_type === type), 'total');
}

export function cashSummary(rows, id) {
  const movements = rows.cash_movements.filter(row => row.cash_register_id === id);
  return {
    sale_count: rows.sales.filter(row => row.cash_register_id === id).length,
    total_cash_sales: saleTotal(id, rows, 'cash'),
    total_credit_sales: saleTotal(id, rows, 'credit'),
    total_credit_collected: sum(rows.credit_payments.filter(row => row.cash_register_id === id), 'amount'),
    total_expenses: sum(movements.filter(row => row.type === 'expense'), 'amount'),
    total_deposits: sum(movements.filter(row => row.type === 'deposit'), 'amount'),
    total_withdrawals: sum(movements.filter(row => row.type === 'withdrawal'), 'amount'),
  };
}

function refreshCash(rows, ids) {
  for (const id of new Set(ids)) {
    if (id == null) continue;
    const row = get(rows, 'cash_register_periods', id);
    const summary = cashSummary(rows, id);
    for (const field of ['total_cash_sales', 'total_credit_sales', 'total_credit_collected', 'total_expenses']) {
      row[field] = summary[field];
    }
    row.version += 1;
  }
}

function assertBoundaries(ctx, id, start, end) {
  requireThat(end == null || start <= end, 422, 'El cierre es anterior al inicio');
  const overlap = ctx.rows.cash_register_periods.some(row => row.id !== id
    && (!row.end_date || row.end_date >= start) && (!end || row.start_date <= end));
  requireThat(!overlap, 409, 'Las fechas se sobreponen con otra caja');
  if (!id) return;
  for (const table of ['sales', 'cash_movements', 'credit_payments']) {
    for (const item of ctx.rows[table].filter(row => row.cash_register_id === id)) {
      checkPeriod({ start_date: start, end_date: end }, ctx.businessDay(item.created_at));
    }
  }
}

export function createCash(ctx) {
  const { rows, body } = ctx;
  requireThat(!openCash(rows), 409, 'Ya hay una caja abierta');
  const start = date(body.start_date);
  assertBoundaries(ctx, null, start, null);
  return ctx.add('cash_register_periods', {
    period_name: text(body.period_name), start_date: start, end_date: null,
    opening_cash: number(body.opening_cash), closing_cash: null, status: 'open', version: 1,
    total_cash_sales: 0, total_credit_sales: 0, total_credit_collected: 0, total_expenses: 0, created_at: ctx.now,
  });
}

function correctionReplay(ctx, action) {
  const { rows, body } = ctx;
  const allowed = action === 'correct'
    ? ['operation_id', 'id', 'version', 'start_date', 'end_date', 'opening_cash', 'closing_cash']
    : ['operation_id', 'sale_id', 'source_id', 'target_id', 'source_version', 'target_version', 'sale_date'];
  requireThat(Object.keys(body).every(field => allowed.includes(field)), 422, 'Campo de corrección inválido');
  requireThat(typeof body.operation_id === 'string'
    && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.operation_id), 422, 'Identificador de corrección inválido');
  const previous = rows.cash_register_corrections.find(item => item.operation_id === body.operation_id);
  if (!previous) return false;
  requireThat(previous.action === action && hash(canonical(previous.request)) === hash(canonical(body)), 409, 'La operación ya existe con otros datos');
  return true;
}

function recordCorrection(ctx, action, previousValues) {
  ctx.rows.cash_register_corrections.push({
    operation_id: ctx.body.operation_id, action, request: { ...ctx.body }, previous_values: previousValues, created_at: ctx.now,
  });
}

export function changeCash(ctx, correcting) {
  const { rows, body } = ctx;
  if (correcting && correctionReplay(ctx, 'correct')) return true;
  const cash = get(rows, 'cash_register_periods', body.id);
  requireThat(cash.status === (correcting ? 'closed' : 'open')
    && (!correcting || cash.version === identifier(body.version)), 409, 'La caja cambió');
  const start = correcting ? date(body.start_date) : cash.start_date;
  const end = ctx.effectiveDay(date(body.end_date));
  assertBoundaries(ctx, cash.id, start, end);
  const previous = { start_date: cash.start_date, end_date: cash.end_date, opening_cash: cash.opening_cash, closing_cash: cash.closing_cash };
  Object.assign(cash, {
    opening_cash: correcting ? number(body.opening_cash) : cash.opening_cash,
    closing_cash: number(body.closing_cash), start_date: start, end_date: end, status: 'closed',
  });
  refreshCash(rows, [cash.id]);
  if (correcting) recordCorrection(ctx, 'correct', previous);
  return correcting ? true : cash;
}

export function transferSale(ctx) {
  if (correctionReplay(ctx, 'transfer')) return true;
  const { rows, body } = ctx;
  const source = get(rows, 'cash_register_periods', body.source_id);
  const target = get(rows, 'cash_register_periods', body.target_id);
  requireThat(source.id !== target.id, 422, 'Selecciona una caja diferente');
  requireThat(source.version === identifier(body.source_version) && target.version === identifier(body.target_version),
    409, 'Las cajas cambiaron');
  const day = ctx.effectiveDay(date(body.sale_date));
  checkPeriod(target, day);
  const sale = get(rows, 'sales', body.sale_id);
  requireThat(sale.cash_register_id === source.id, 409, 'La venta ya cambió de caja');
  const previous = { cash_register_id: sale.cash_register_id, created_at: sale.created_at };
  if (ctx.businessDay(sale.created_at) !== day) {
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: ctx.zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).format(new Date(sale.created_at));
    sale.created_at = timeOnDate(day, clock, ctx.zone);
  }
  sale.cash_register_id = target.id;
  refreshCash(rows, [source.id, target.id]);
  recordCorrection(ctx, 'transfer', previous);
  return true;
}

export function changeMovement(ctx, id, action) {
  const { rows, body } = ctx;
  const key = action === 'create' ? keyOf(body.idempotency_key) : null;
  const previous = key && rows.cash_movements.find(row => row.idempotency_key === key);
  if (previous) return previous;
  const movement = action === 'create' ? null : get(rows, 'cash_movements', id);
  const cash = get(rows, 'cash_register_periods', movement?.cash_register_id ?? body.cash_register_id);
  requireThat(cash.status === 'open', 409, 'La caja está cerrada');
  if (action === 'delete') {
    drop(rows, 'cash_movements', row => row.id === id);
    refreshCash(rows, [cash.id]);
    return { deleted: true };
  }
  const day = body.movement_date ?? (movement && ctx.businessDay(movement.created_at)) ?? ctx.today;
  checkPeriod(cash, ctx.effectiveDay(day));
  const changes = {
    type: enumOf(body.type ?? movement?.type, ['expense', 'withdrawal', 'deposit']),
    amount: number(body.amount ?? movement?.amount, 0.01),
    description: Object.hasOwn(body, 'description') ? text(body.description, 255, true) : movement?.description ?? null,
    created_at: body.movement_date ? ctx.timestamp(body.movement_date) : movement?.created_at ?? ctx.now,
  };
  const result = movement
    ? Object.assign(movement, changes)
    : ctx.add('cash_movements', { ...changes, cash_register_id: cash.id, idempotency_key: key });
  refreshCash(rows, [cash.id]);
  return result;
}

export function saveCategory(ctx, id) {
  const target = id ? get(ctx.rows, 'categories', id) : null;
  const name = text(ctx.body.name ?? target?.name);
  const value = Object.hasOwn(ctx.body, 'parent_id') ? ctx.body.parent_id : target?.parent_id;
  const parentId = value == null ? null : identifier(value);
  const ancestors = new Set(id ? [id] : []);
  for (let parent = parentId; parent != null;) {
    requireThat(!ancestors.has(parent), 409, 'La categoría no puede crear un ciclo');
    ancestors.add(parent);
    parent = get(ctx.rows, 'categories', parent).parent_id;
  }
  return target ? Object.assign(target, { name, parent_id: parentId })
    : ctx.add('categories', { name, parent_id: parentId, created_at: ctx.now });
}

export function deleteCategory(ctx, id) {
  get(ctx.rows, 'categories', id);
  for (const row of ctx.rows.categories) if (row.parent_id === id) row.parent_id = null;
  for (const row of ctx.rows.products) if (row.category_id === id) row.category_id = null;
  drop(ctx.rows, 'categories', row => row.id === id);
  return { deleted: true };
}

function activeFlag(value) {
  return number(value, 0, 1, 0);
}

export function saveCustomer(ctx, id) {
  const row = id ? get(ctx.rows, 'customers', id) : null;
  const fields = { name: text(ctx.body.name ?? row?.name), is_active: activeFlag(ctx.body.is_active ?? row?.is_active ?? 1) };
  for (const field of ['phone', 'email', 'notes']) {
    fields[field] = Object.hasOwn(ctx.body, field) ? text(ctx.body[field], 255, true) : row?.[field] ?? null;
  }
  if (!fields.is_active && row) {
    requireThat(!ctx.rows.credits.some(credit => credit.customer_id === id && credit.status !== 'paid'), 409, 'El cliente tiene créditos pendientes');
  }
  return row ? Object.assign(row, fields) : ctx.add('customers', { ...fields, created_at: ctx.now });
}

export function deleteCustomer(ctx, id) {
  ctx.body = { is_active: 0 };
  saveCustomer(ctx, id);
  return { deleted: true };
}

function price(cost, margin) {
  return Number((BigInt(Math.round(cost * 100)) * BigInt(10000 + Math.round(margin * 100)) + 5000n) / 10000n) / 100;
}

export function saveProduct(ctx, id) {
  const { rows, body } = ctx;
  const row = id ? get(rows, 'products', id) : null;
  const barcode = text(body.barcode ?? row?.barcode, 128);
  requireThat(!rows.products.some(other => other.id !== id && other.barcode === barcode), 409, 'El código ya existe');
  const category = Object.hasOwn(body, 'category_id') ? body.category_id : row?.category_id;
  const cost = number(body.cost_price ?? row?.cost_price);
  const margin = number(body.margin_percent ?? row?.margin_percent ?? 0, 0, 9999.99);
  const fields = {
    name: text(body.name ?? row?.name), barcode, category_id: category == null ? null : get(rows, 'categories', category).id,
    description: Object.hasOwn(body, 'description') ? text(body.description, 4096, true) : row?.description ?? null,
    cost_price: cost, margin_percent: margin, sale_price: price(cost, margin),
    min_stock: number(body.min_stock ?? row?.min_stock ?? 5, -1, 1e9, 3),
    is_active: activeFlag(body.is_active ?? row?.is_active ?? 1), updated_at: ctx.now,
  };
  if (row) return Object.assign(row, fields);
  const product = ctx.add('products', { ...fields, stock: number(body.stock ?? 0, 0, 1e9, 3), created_at: ctx.now });
  if (product.stock > 0) ctx.add('inventory_movements', {
    product_id: product.id, type: 'in', quantity: product.stock, reference_id: null, notes: 'Existencia inicial', created_at: ctx.now,
  });
  return product;
}

export function canDeleteProduct(rows, id) {
  return Boolean(find(rows, 'products', id)) && !rows.sale_items.some(row => row.product_id === id);
}

export function deleteProduct(ctx, id, permanent) {
  const row = get(ctx.rows, 'products', id);
  if (!permanent) row.is_active = 0;
  else {
    requireThat(canDeleteProduct(ctx.rows, id), 409, 'El producto tiene ventas');
    drop(ctx.rows, 'inventory_movements', entry => entry.product_id === id);
    drop(ctx.rows, 'products', entry => entry.id === id);
  }
  return { deleted: true };
}

function updateStock(ctx, product, delta, notes, referenceId, movementType, createdAt) {
  const stock = (Math.round(product.stock * 1000) + Math.round(delta * 1000)) / 1000;
  requireThat(stock >= 0, 409, 'Inventario insuficiente');
  Object.assign(product, { stock, updated_at: ctx.now });
  return ctx.add('inventory_movements', {
    product_id: product.id, type: movementType, quantity: delta, reference_id: referenceId,
    notes, created_at: createdAt,
  });
}

export function moveInventory(ctx) {
  const { rows, body } = ctx;
  const product = get(rows, 'products', body.product_id);
  const type = enumOf(body.type, ['in', 'out', 'adjustment']);
  const quantity = type === 'adjustment'
    ? number(body.quantity, -1e9, 1e9, 0)
    : number(body.quantity, 0.001, 1e9, 3);
  requireThat(quantity !== 0, 422, 'La cantidad debe ser distinta de cero');
  if (type === 'in') {
    product.cost_price = number(body.cost_price ?? product.cost_price);
    product.margin_percent = number(body.margin_percent ?? product.margin_percent, 0, 9999.99);
    product.sale_price = price(product.cost_price, product.margin_percent);
  }
  return updateStock(ctx, product, type === 'out' ? -quantity : quantity,
    text(body.notes, 255, true), body.reference_id == null ? null : identifier(body.reference_id), type, ctx.now);
}

function getCreditPayment(ctx, credit, amount, cash, key, time) {
  credit.amount_paid = sum([credit, { amount_paid: amount }], 'amount_paid');
  if (credit.amount_paid >= credit.total_due) Object.assign(credit, { status: 'paid', paid_at: time });
  ctx.add('credit_payments', {
    credit_id: credit.id, cash_register_id: cash.id, amount, idempotency_key: key, created_at: time,
  });
}

export function checkout(ctx, historical) {
  const { rows, body } = ctx;
  const kind = enumOf(body.sale_type, ['cash', 'credit']);
  const key = keyOf(body.idempotency_key);
  requireThat(!key || !ctx.reversedSales.some(sale => sale.idempotencyKey === key), 409, 'La venta original ya fue revertida');
  requireThat(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 30, 422, 'Agrega entre 1 y 30 productos');
  const quantities = new Set();
  const items = body.items.map(item => {
    requireThat(item && typeof item === 'object', 422, 'Línea de venta inválida');
    const productId = identifier(item.product_id);
    requireThat(!quantities.has(productId), 422, 'Producto repetido en la venta');
    quantities.add(productId);
    return [productId, number(item.quantity, 0.001, 1e6, 3), number(item.unit_price)];
  });
  const signature = hash([
    body.sale_type, body.cash_register_id, body.sale_date, body.customer_id, body.cash_received,
    body.credit_days, body.initial_payment, body.surcharge_percent, body.items.map(item => [item.product_id, item.quantity, item.unit_price]),
  ]);
  const existing = key && rows.sales.find(row => row.idempotency_key === key);
  if (existing) {
    requireThat(!existing.request_hash || existing.request_hash === signature, 409, 'La venta ya existe con otros datos');
    return { sale: existing, created: false };
  }
  const cash = historical ? get(rows, 'cash_register_periods', body.cash_register_id) : requireOpen(rows);
  if (historical) {
    requireThat(cash.status === 'closed', 409, 'Selecciona una caja cerrada');
    date(body.sale_date);
  } else {
    requireThat(body.cash_register_id == null, 422, 'Usa la captura histórica para elegir otra caja');
  }
  const day = ctx.effectiveDay(body.sale_date);
  const time = day === ctx.today ? ctx.now : ctx.timestamp(body.sale_date);
  checkPeriod(cash, day);
  const customer = body.customer_id == null && kind === 'cash' ? null : get(rows, 'customers', body.customer_id);
  requireThat(!customer || customer.is_active === 1, 409, 'El cliente está inactivo');
  const planned = items.map(([productId, quantity, requestedPrice]) => {
    const product = get(rows, 'products', productId);
    requireThat(product.is_active === 1 && product.stock >= quantity && product.sale_price === requestedPrice,
      409, 'El producto, precio o stock cambió');
    const cents = (BigInt(Math.round(quantity * 1000)) * BigInt(Math.round(product.sale_price * 100)) + 500n) / 1000n;
    requireThat(cents <= 100000000000n, 422, 'Importe de línea fuera del límite');
    return { product, quantity, unit_price: product.sale_price, line_total: Number(cents) / 100 };
  });
  const subtotal = sum(planned, 'line_total');
  const received = kind === 'cash' ? number(body.cash_received, subtotal) : null;
  const change = received === null ? null : sum([{ n: received }, { n: -subtotal }], 'n');
  if (body.cash_change != null && change != null) requireThat(number(body.cash_change) === change, 422, 'El cambio calculado es distinto');
  const sale = ctx.add('sales', {
    sale_type: kind, customer_id: customer?.id ?? null, subtotal, surcharge: 0, total: subtotal,
    cash_received: received, cash_change: change, cash_register_id: cash.id, idempotency_key: key,
    created_at: time, captured_at: ctx.now, request_hash: signature,
  });
  for (const { product, ...line } of planned) {
    ctx.add('sale_items', { ...line, sale_id: sale.id, product_id: product.id });
    updateStock(ctx, product, -line.quantity, 'Venta automática de ensayo', sale.id, 'out', time);
  }
  if (kind === 'credit') {
    const days = number(body.credit_days ?? Number(settingsValue(rows, 'default_credit_days', 5)), 1, 36500, 0);
    const surcharge = number(body.surcharge_percent ?? 0, 0, 9999.99);
    const initial = number(body.initial_payment ?? 0, 0, subtotal);
    const credit = ctx.add('credits', {
      sale_id: sale.id, customer_id: customer.id, original_amount: subtotal, due_date: shiftDays(day, days),
      surcharge_percent: surcharge, surcharge_applied: 0, total_due: subtotal, amount_paid: 0,
      status: 'pending', paid_at: null, created_at: time,
    });
    if (initial > 0) getCreditPayment(ctx, credit, initial, cash, null, time);
  }
  refreshCash(rows, [cash.id]);
  return { sale, created: true };
}

export function reverseSale(ctx, id) {
  const { rows } = ctx;
  const sale = find(rows, 'sales', id);
  if (!sale) return { deleted: false };
  const credit = rows.credits.find(row => row.sale_id === id);
  const affected = [sale.cash_register_id];
  if (credit) {
    const payments = rows.credit_payments.filter(row => row.credit_id === credit.id);
    affected.push(...payments.map(row => row.cash_register_id));
    drop(rows, 'credit_payments', row => row.credit_id === credit.id);
    drop(rows, 'credits', row => row.id === credit.id);
  }
  for (const line of rows.sale_items.filter(row => row.sale_id === id)) {
    updateStock(ctx, get(rows, 'products', line.product_id), line.quantity, 'Reversión de venta de ensayo', id, 'in', ctx.now);
  }
  drop(rows, 'sale_items', row => row.sale_id === id);
  drop(rows, 'sales', row => row.id === id);
  if (sale.idempotency_key) {
    ctx.reversedSales.push({ idempotencyKey: sale.idempotency_key, entityId: id,
      requestHash: sale.request_hash ?? null, reversedAt: ctx.now });
  }
  refreshCash(rows, affected);
  return { deleted: true };
}

export function addPayment(ctx, id) {
  const { rows, body } = ctx;
  const key = keyOf(body.idempotency_key);
  const amount = number(body.amount, 0.01);
  const credit = get(rows, 'credits', id);
  const existing = key && rows.credit_payments.find(row => row.idempotency_key === key);
  if (existing) {
    requireThat(existing.credit_id === id && existing.amount === amount
      && (!body.payment_date || ctx.businessDay(existing.created_at) === body.payment_date),
    409, 'El abono ya existe con otros datos');
    return { credit, created: false };
  }
  requireThat(credit.status !== 'paid', 409, 'El crédito ya está liquidado');
  const cash = requireOpen(rows);
  checkPeriod(cash, ctx.effectiveDay(body.payment_date));
  getCreditPayment(ctx, credit, amount, cash, key, ctx.timestamp(body.payment_date));
  refreshCash(rows, [cash.id]);
  return { credit, created: true };
}

function applySurcharge(rows, credit) {
  const sale = get(rows, 'sales', credit.sale_id);
  credit.total_due = price(credit.original_amount, credit.surcharge_percent);
  sale.surcharge = sum([{ n: credit.total_due }, { n: -credit.original_amount }], 'n');
  sale.total = sum([{ n: sale.subtotal }, { n: sale.surcharge }], 'n');
  return sale.cash_register_id;
}

export function changeCredit(ctx, id) {
  const { rows, body } = ctx;
  const credit = get(rows, 'credits', id);
  requireThat(credit.status !== 'paid', 409, 'El crédito ya está liquidado');
  requireThat(body.due_date !== undefined || body.surcharge_percent !== undefined, 400, 'Faltan campos');
  if (body.due_date !== undefined) credit.due_date = date(body.due_date);
  if (body.surcharge_percent !== undefined) {
    credit.surcharge_percent = number(body.surcharge_percent, 0, 100);
    if (credit.surcharge_applied === 1) refreshCash(rows, [applySurcharge(rows, credit)]);
  }
  return credit;
}

export function recalculateOverdue(ctx) {
  const overdue = ctx.rows.credits.filter(row => row.status === 'pending' && row.surcharge_applied === 0 && row.due_date < ctx.today);
  const affected = [];
  for (const credit of overdue) {
    credit.status = 'overdue';
    credit.surcharge_applied = 1;
    affected.push(applySurcharge(ctx.rows, credit));
  }
  refreshCash(ctx.rows, affected);
  return { updated_count: overdue.length };
}
