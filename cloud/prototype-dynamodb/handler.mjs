import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  RequestError, requireThat, text, number, context, find, sum, openCash, cashSummary,
  createCash, changeCash, transferSale, changeMovement, saveCategory, deleteCategory,
  saveCustomer, deleteCustomer, saveProduct, canDeleteProduct, deleteProduct, moveInventory,
  checkout, reverseSale, addPayment, changeCredit, recalculateOverdue,
} from './domain.mjs';
import { createDynamoStore, PrototypeLimit, StaleSnapshot } from './store.mjs';
import { createCollectionStore } from './collection-store.mjs';

const ROUTES = [];
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const SETTING_KEYS = {
  store: ['store_name', 'store_address', 'store_phone', 'ticket_footer_text'],
  products: ['default_margin_percent'],
  credits: ['default_credit_days', 'default_surcharge_percent', 'business_timezone'],
};

function route(method, path, execute, status = 200, keyed) {
  const pattern = path.replace(':id', '(\\d+)').replace(':barcode', '([^/]+)').replace(':section', '(store|products|credits)');
  ROUTES.push({ method, path, pattern: new RegExp('^/v1' + pattern + '$'), execute, status, keyed });
}

function orderByTime(rows) {
  return [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);
}

function orderByName(rows) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, 'es') || a.id - b.id);
}

function searchMatch(search, values) {
  const needle = (search ?? '').trim().toLowerCase();
  return !needle || values.some(value => String(value ?? '').toLowerCase().includes(needle));
}

function dateFilter(ctx, row, from, to) {
  if (!from && !to) return true;
  const day = ctx.businessDay(row.created_at);
  return (!from || day >= from) && (!to || day <= to);
}

function rowById(ctx, table, id) {
  return find(ctx.rows, table, Number(id)) ?? null;
}

function customers(ctx) {
  const { rows, query: q } = ctx;
  const customers = rows.customers.filter(row => row.is_active === (q.status === 'inactive' ? 0 : 1)
    && searchMatch(q.search, [row.name, row.email, row.phone]));
  return orderByName(customers).map(row => {
    const credits = orderByTime(rows.credits.filter(credit => credit.customer_id === row.id));
    const active = credits.filter(credit => credit.status !== 'paid');
    return {
      ...row, total_credits: credits.length, active_credits: active.length,
      overdue_credits: credits.filter(credit => credit.status === 'overdue').length,
      total_debt: sum(active, 'total_due') - sum(active, 'amount_paid'), total_paid: sum(credits, 'amount_paid'),
      last_credit_date: credits[0]?.created_at ?? null,
    };
  }).filter(row => (q.credit_status !== 'withDebt' || row.total_debt > 0)
    && (q.credit_status !== 'overdue' || row.overdue_credits > 0)
    && (q.credit_status !== 'withoutCredits' || row.total_credits === 0));
}

function selectedProducts(ctx) {
  const q = ctx.query;
  return orderByName(ctx.rows.products.filter(row => (
    (!q.category_id || row.category_id === Number(q.category_id))
    && (q.low_stock !== 'true' || isLow(row))
    && searchMatch(q.search, [row.name, row.barcode, row.description])
  )));
}

function isLow(row) {
  return row.is_active === 1 && row.min_stock >= 0 && row.stock <= row.min_stock;
}

function selectedSales(ctx, cashId = null) {
  const q = ctx.query;
  return orderByTime(ctx.rows.sales.filter(row =>
    (cashId === null || row.cash_register_id === cashId) && (!q.type || row.sale_type === q.type)
    && dateFilter(ctx, row, q.date_from, q.date_to))).map(row => {
    const items = ctx.rows.sale_items.filter(item => item.sale_id === row.id);
    return { ...row, customer_name: find(ctx.rows, 'customers', row.customer_id)?.name ?? null,
      item_count: items.reduce((count, item) => count + item.quantity, 0) };
  });
}

function saleDetail(ctx, id) {
  const sale = rowById(ctx, 'sales', id);
  if (!sale) return null;
  const customer = find(ctx.rows, 'customers', sale.customer_id);
  const items = ctx.rows.sale_items.filter(row => row.sale_id === sale.id).sort((a, b) => a.id - b.id).map(item => {
    const product = find(ctx.rows, 'products', item.product_id);
    return { ...item, product_name: product?.name ?? 'Producto eliminado', product_barcode: product?.barcode ?? '' };
  });
  return { ...sale, customer_name: customer?.name ?? null, customer_phone: customer?.phone ?? null,
    customer_email: customer?.email ?? null, items };
}

function creditRows(ctx) {
  const q = ctx.query;
  return orderByTime(ctx.rows.credits.filter(row => (!q.status || q.status === row.status)
    && dateFilter(ctx, row, q.date_from, q.date_to))).map(row => ({
    ...row, business_date: ctx.businessDay(row.created_at), customer_name: find(ctx.rows, 'customers', row.customer_id)?.name ?? null,
  }));
}

function creditPaymentsByCash(ctx, id) {
  return orderByTime(ctx.rows.credit_payments.filter(row => row.cash_register_id === Number(id))).map(row => {
    const credit = find(ctx.rows, 'credits', row.credit_id);
    const customer = find(ctx.rows, 'customers', credit.customer_id);
    return { ...row, sale_id: credit.sale_id, customer_id: credit.customer_id,
      credit_status: credit.status, customer_name: customer?.name ?? null };
  });
}

function inventoryMovements(ctx, id = null) {
  const type = ctx.query.type;
  return orderByTime(ctx.rows.inventory_movements.filter(row => (id === null || row.product_id === id)
    && (!type || row.type === type))).map(row => {
    const product = find(ctx.rows, 'products', row.product_id);
    return { ...row, product_name: product?.name ?? 'Producto eliminado', product_barcode: product?.barcode ?? '' };
  });
}

function reportSales(ctx) {
  const { start_date: start, end_date: end } = ctx.query;
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(start ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(end ?? '')
    && start <= end, 422, 'Indica un rango de fechas válido');
  return ctx.rows.sales.filter(row => dateFilter(ctx, row, start, end));
}

function reportDaily(ctx) {
  const groups = new Map();
  for (const row of reportSales(ctx)) {
    const date = ctx.businessDay(row.created_at);
    const group = groups.get(date) ?? [];
    group.push(row);
    groups.set(date, group);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => ({
    date, count: rows.length, total_cash: sum(rows.filter(row => row.sale_type === 'cash'), 'total'),
    total_credit: sum(rows.filter(row => row.sale_type === 'credit'), 'total'), total: sum(rows, 'total'),
  }));
}

function productReport(ctx, profit) {
  const sales = new Set(reportSales(ctx).map(row => row.id));
  const groups = new Map();
  for (const line of ctx.rows.sale_items.filter(row => sales.has(row.sale_id))) {
    const group = groups.get(line.product_id) ?? [];
    group.push(line);
    groups.set(line.product_id, group);
  }
  const rows = [...groups].map(([id, lines]) => {
    const product = find(ctx.rows, 'products', id);
    const quantity = lines.reduce((total, line) => total + Math.round(line.quantity * 1000), 0) / 1000;
    const revenue = sum(lines, 'line_total');
    const row = { product_id: id, product_name: product.name, total_quantity: quantity, total_revenue: revenue };
    if (!profit) return row;
    const cost = quantity * product.cost_price;
    return { ...row, total_cost: cost, profit: revenue - cost,
      margin: revenue ? Math.round((revenue - cost) * 10000 / revenue) / 100 : 0 };
  });
  if (profit) return rows.sort((a, b) => b.profit - a.profit);
  const limit = ctx.query.limit === undefined ? 10 : number(ctx.query.limit, 1, 500, 0);
  return rows.sort((a, b) => b.total_revenue - a.total_revenue).slice(0, limit);
}

function stockReport(ctx) {
  return ctx.rows.products.filter(row => row.is_active === 1).map(row => ({
    product_id: row.id, product_name: row.name, stock: row.stock, min_stock: row.min_stock,
    cost_price: row.cost_price, sale_price: row.sale_price,
    stock_value_cost: Math.round(row.stock * row.cost_price * 100) / 100,
    stock_value_sale: Math.round(row.stock * row.sale_price * 100) / 100,
  })).sort((a, b) => b.stock_value_cost - a.stock_value_cost);
}

function inventorySummary(ctx) {
  const active = stockReport(ctx);
  return {
    total_products: ctx.rows.products.length, total_active: active.length,
    total_stock_units: active.reduce((total, row) => total + row.stock, 0),
    total_value_cost: sum(active, 'stock_value_cost'), total_value_sale: sum(active, 'stock_value_sale'),
    low_stock_count: ctx.rows.products.filter(isLow).length,
  };
}

function creditsOverview(ctx) {
  return ['overdue', 'pending', 'paid'].flatMap(status => {
    const rows = ctx.rows.credits.filter(row => row.status === status);
    if (!rows.length) return [];
    const total_due = sum(rows, 'total_due');
    const total_paid = sum(rows, 'amount_paid');
    return [{ status, count: rows.length, total_due, total_paid, total_remaining: total_due - total_paid }];
  });
}

function settings(ctx, section, mutating) {
  const keys = SETTING_KEYS[section];
  const current = new Map(ctx.rows.settings.map(row => [row.key, row]));
  if (mutating) {
    const { values } = ctx.body;
    requireThat(values && typeof values === 'object' && !Array.isArray(values)
      && Object.keys(values).length > 0, 422, 'Agrega valores de configuración');
    for (const [key, value] of Object.entries(values)) {
      requireThat(keys.includes(key) && typeof value === 'string' && value.length <= 300, 422, 'Configuración inválida');
      let normalized = value.trim();
      if (key === 'default_credit_days') normalized = String(number(normalized, 1, 36500, 0));
      if (key === 'default_margin_percent' || key === 'default_surcharge_percent') normalized = String(number(normalized, 0, 9999.99));
      if (key === 'store_name') normalized = text(normalized, 150);
      if (key === 'business_timezone') {
        try {
          new Intl.DateTimeFormat('es-MX', { timeZone: text(normalized, 80) });
        } catch {
          throw new RequestError(422, 'Zona horaria inválida');
        }
      }
      if (current.has(key)) current.get(key).value = normalized;
      else {
        const row = { key, value: normalized };
        current.set(key, row);
        ctx.rows.settings.push(row);
      }
    }
  }
  return { section, values: Object.fromEntries(keys.map(key => [key, current.get(key)?.value
    ?? (key === 'business_timezone' ? current.get('business_time_zone')?.value : null) ?? ''])) };
}

route('GET', '/health', ctx => ({ status: 'ok', service: ctx.stage === 'prod' ? 'pos-api' : 'pos-api-dynamodb-prototype',
  env: ctx.stage, db_time: ctx.now }));
route('GET', '/settings/sections/:section', (ctx, section) => settings(ctx, section, false));
route('PUT', '/settings/sections/:section', (ctx, section) => settings(ctx, section, true));

route('GET', '/categories', ctx => orderByName(ctx.rows.categories));
route('POST', '/categories', ctx => saveCategory(ctx), 201);
route('PUT', '/categories/:id', (ctx, id) => saveCategory(ctx, Number(id)));
route('DELETE', '/categories/:id', (ctx, id) => deleteCategory(ctx, Number(id)));

route('GET', '/products', selectedProducts);
route('GET', '/products/low-stock', ctx => orderByName(ctx.rows.products.filter(isLow)));
route('GET', '/products/barcode/:barcode', (ctx, code) => ctx.rows.products.find(row => row.is_active === 1
  && row.barcode === code) ?? null, 200, 'barcode');
route('GET', '/products/:id', (ctx, id) => rowById(ctx, 'products', id), 200, 'products');
route('GET', '/products/:id/can-delete-permanently', (ctx, id) => ({ canDelete: canDeleteProduct(ctx.rows, Number(id)) }));
route('GET', '/products/:id/inventory-movements', (ctx, id) => inventoryMovements(ctx, Number(id)), 200, 'inventoryMovements');
route('POST', '/products', ctx => saveProduct(ctx), 201);
route('PUT', '/products/:id', (ctx, id) => saveProduct(ctx, Number(id)));
route('DELETE', '/products/:id', (ctx, id) => deleteProduct(ctx, Number(id), false));
route('DELETE', '/products/:id/permanent', (ctx, id) => deleteProduct(ctx, Number(id), true));

route('GET', '/customers', customers);
route('GET', '/customers/:id', (ctx, id) => rowById(ctx, 'customers', id), 200, 'customers');
route('POST', '/customers', ctx => saveCustomer(ctx), 201);
route('PUT', '/customers/:id', (ctx, id) => saveCustomer(ctx, Number(id)));
route('DELETE', '/customers/:id', (ctx, id) => deleteCustomer(ctx, Number(id)));
route('GET', '/customers/:id/credits', (ctx, id) => creditRows(ctx).filter(row => row.customer_id === Number(id)));

route('GET', '/inventory/movements', ctx => inventoryMovements(ctx));
route('POST', '/inventory/movements', moveInventory, 201);

route('GET', '/cash-register/current', ctx => openCash(ctx.rows) ?? null, 200, 'currentCash');
route('GET', '/cash-register/periods', ctx => orderByTime(ctx.rows.cash_register_periods)
  .map(row => ({ ...cashSummary(ctx.rows, row.id), ...row })));
route('POST', '/cash-register/open', createCash, 201);
route('POST', '/cash-register/close', ctx => changeCash(ctx, false));
route('POST', '/cash-register/correct', ctx => changeCash(ctx, true));
route('POST', '/cash-register/transfer', transferSale);
route('POST', '/cash-register/historical-sale', ctx => checkout(ctx, true), result => result.created ? 201 : 200);
route('GET', '/cash-register/:id/movements', (ctx, id) => orderByTime(ctx.rows.cash_movements.filter(row => row.cash_register_id === Number(id))), 200, 'cashMovements');
route('POST', '/cash-register/movements', ctx => changeMovement(ctx, null, 'create'), 201);
route('PUT', '/cash-register/movements/:id', (ctx, id) => changeMovement(ctx, Number(id), 'update'));
route('DELETE', '/cash-register/movements/:id', (ctx, id) => changeMovement(ctx, Number(id), 'delete'));
route('GET', '/cash-register/:id/sales', (ctx, id) => selectedSales(ctx, Number(id)));
route('GET', '/cash-register/:id/credit-payments', creditPaymentsByCash);
route('GET', '/cash-register/:id/sales-summary', (ctx, id) => cashSummary(ctx.rows, Number(id)));

route('POST', '/sales', ctx => checkout(ctx, false), result => result.created ? 201 : 200);
route('GET', '/sales', selectedSales);
route('GET', '/sales/:id', (ctx, id) => rowById(ctx, 'sales', id), 200, 'sales');
route('GET', '/sales/:id/detail', saleDetail, 200, 'saleDetail');
route('DELETE', '/sales/:id', (ctx, id) => reverseSale(ctx, Number(id)));
route('GET', '/sales/summary', ctx => {
  const rows = selectedSales(ctx).filter(row => searchMatch(ctx.query.search, [row.customer_name, row.id, row.total]));
  return { totalSales: rows.length, totalRevenue: sum(rows, 'total'),
    cashRevenue: sum(rows.filter(row => row.sale_type === 'cash'), 'total'),
    creditRevenue: sum(rows.filter(row => row.sale_type === 'credit'), 'total') };
});

route('GET', '/credits', creditRows);
route('GET', '/credits/:id', (ctx, id) => rowById(ctx, 'credits', id), 200, 'credits');
route('GET', '/credits/:id/payments', (ctx, id) => orderByTime(ctx.rows.credit_payments.filter(row => row.credit_id === Number(id))), 200, 'creditPayments');
route('POST', '/credits/:id/payments', (ctx, id) => addPayment(ctx, Number(id)), result => result.created ? 201 : 200);
route('PUT', '/credits/:id', (ctx, id) => changeCredit(ctx, Number(id)));
route('POST', '/credits/recalculate-overdue', recalculateOverdue);
route('GET', '/credits/summary', ctx => {
  const rows = creditRows(ctx).filter(row => searchMatch(ctx.query.search, [row.customer_name, row.id, row.sale_id]));
  const pending = rows.filter(row => row.status === 'pending');
  const overdue = rows.filter(row => row.status === 'overdue');
  return { countActive: pending.length + overdue.length, totalPending: sum(pending, 'total_due') - sum(pending, 'amount_paid'),
    totalOverdue: sum(overdue, 'total_due') - sum(overdue, 'amount_paid'), totalCollected: sum(rows, 'amount_paid') };
});

route('GET', '/reports/sales-by-date', reportDaily);
route('GET', '/reports/top-products', ctx => productReport(ctx, false));
route('GET', '/reports/profit', ctx => productReport(ctx, true));
route('GET', '/reports/inventory', stockReport);
route('GET', '/reports/inventory-summary', inventorySummary);
route('GET', '/reports/credits-overview', creditsOverview);

export const routeContracts = Object.freeze(ROUTES.map(({ method, path }) => [method, '/v1' + path]));

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

function authenticate(event, secrets, stage, apiId) {
  requireThat(event.requestContext?.stage === stage && (!apiId || event.requestContext?.apiId === apiId),
    403, 'Destino de API inválido');
  const header = Object.entries(event.headers ?? {}).find(([name]) => name.toLowerCase() === 'x-api-key')?.[1];
  const minimum = stage === 'test' ? 32 : 20;
  requireThat(typeof header === 'string' && header.length <= 256 && header.length >= minimum, 403, 'Credencial inválida');
  const incoming = digest(header.trim());
  requireThat(secrets.some(secret => typeof secret === 'string' && secret.length >= minimum
    && timingSafeEqual(digest(secret), incoming)), 403, 'Credencial inválida');
}

function requestBody(event, method) {
  if (!event.body || method === 'GET') return {};
  requireThat(!event.isBase64Encoded && typeof event.body === 'string' && event.body.length <= 32768, 422, 'Solicitud inválida');
  let parsed;
  try {
    parsed = JSON.parse(event.body);
  } catch {
    throw new RequestError(422, 'Solicitud inválida');
  }
  requireThat(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 422, 'Solicitud inválida');
  return parsed;
}

function json(statusCode, body) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body) };
}

export function createHandler({ store, apiKey, stage = 'test', apiId,
  writesEnabled = stage === 'test', verifyReady, now = () => new Date().toISOString() }) {
  const secrets = Array.isArray(apiKey) ? apiKey : [apiKey];
  return async event => {
    const requestId = randomUUID();
    try {
      authenticate(event, secrets, stage, apiId);
      const method = event.httpMethod ?? event.requestContext?.http?.method;
      const rawPath = event.path ?? event.rawPath ?? '';
      const path = typeof rawPath === 'string' && rawPath.startsWith('/' + stage + '/v1/')
        ? rawPath.slice(stage.length + 1) : rawPath;
      requireThat(METHODS.has(method) && typeof path === 'string' && path.length <= 512, 404, 'Ruta inválida');
      const matched = ROUTES.find(candidate => candidate.method === method && candidate.pattern.test(path));
      requireThat(matched, 404, 'Ruta no encontrada');
      if ((method !== 'GET' && !writesEnabled) || (verifyReady && !await verifyReady())) {
        return json(503, { ok: false, error: { code: 'maintenance', message: 'El POS está en mantenimiento' }, request_id: requestId });
      }
      const query = event.queryStringParameters ?? {};
      requireThat(Object.values(query).every(value => typeof value === 'string' && value.length <= 512), 422, 'Filtro inválido');
      const captures = matched.pattern.exec(path).slice(1).map(value => {
        try {
          return decodeURIComponent(value);
        } catch {
          throw new RequestError(422, 'Ruta inválida');
        }
      });
      const body = requestBody(event, method);
      const before = matched.keyed && store.readByKey
        ? await store.readByKey(matched.keyed, captures[0])
        : store.readFor
          ? await store.readFor(method + ' ' + matched.path, body, captures[0])
          : await store.read();
      const state = method === 'GET' ? before : structuredClone(before);
      const data = matched.execute({ ...context(state, body, now()), query, stage }, ...captures);
      if (method !== 'GET') await store.commit(before, state);
      const status = typeof matched.status === 'function' ? matched.status(data) : matched.status;
      return json(status, { ok: true, data, request_id: requestId });
    } catch (error) {
      if (error instanceof RequestError) {
        const code = { 400: 'bad_request', 403: 'forbidden', 404: 'not_found', 409: 'business_conflict', 422: 'validation_error' }[error.status];
        return json(error.status, { ok: false, error: { code, message: error.message }, request_id: requestId });
      }
      if (error instanceof StaleSnapshot || error instanceof PrototypeLimit) {
        return json(409, { ok: false, error: { code: 'business_conflict', message: 'La operación cambió o excede el límite permitido' },
          request_id: requestId });
      }
      console.error('prototype_handler_error', { request_id: requestId, name: error.name });
      return json(500, { ok: false, error: { code: 'internal_error', message: 'Error interno de la API' }, request_id: requestId });
    }
  };
}

let awsHandler;
export async function handler(event) {
  if (!awsHandler) {
    if (process.env.APP_ENV !== 'test' || process.env.AWS_REGION !== 'mx-central-1') {
      return json(503, { ok: false, error: { code: 'invalid_environment', message: 'Ambiente de pruebas inválido' } });
    }
    const sdk = await import('@aws-sdk/client-dynamodb');
    const client = new sdk.DynamoDBClient({ region: 'mx-central-1', maxAttempts: 1 });
    const commands = { GetItem: sdk.GetItemCommand, Query: sdk.QueryCommand, Scan: sdk.ScanCommand,
      TransactWriteItems: sdk.TransactWriteItemsCommand };
    const send = (name, input) => client.send(new commands[name](input));
    const store = process.env.MICHI_DYNAMO_LAYOUT === 'collections' ? createCollectionStore(send) : createDynamoStore(send);
    awsHandler = createHandler({ store, apiKey: process.env.POC_API_KEY });
  }
  return awsHandler(event);
}
