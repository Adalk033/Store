import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DATASET, createDynamoStore, emptyRows, PrototypeLimit, StaleSnapshot } from './store.mjs';
import { createHandler, routeContracts } from './handler.mjs';
import { createCollectionStore } from './collection-store.mjs';
import { importSnapshot } from './migration.mjs';
import { createProductionHandler, PRODUCTION_STORAGE } from './production-handler.mjs';
import { RECOVERY_PARTITION, replayRecoveryJournal } from './recovery.mjs';
import { CloudApi } from '../../electron/lib/cloudApi.ts';

const secret = 'local-fixture-secret-used-only-by-node-tests';
const fixedTime = '2026-11-26T19:07:11.000Z';

function event(method, pathname, body) {
  const url = new URL(pathname, 'https://local.example');
  return {
    httpMethod: method, path: url.pathname, requestContext: { stage: 'test' },
    headers: { 'x-api-key': secret }, queryStringParameters: Object.fromEntries(url.searchParams),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function testContext({ time = fixedTime } = {}) {
  const rows = emptyRows();
  rows.categories.push({ id: 1, name: 'Cuadernos', parent_id: null, created_at: fixedTime });
  rows.products.push({ id: 1, name: 'Cuaderno ficticio', barcode: 'TEST1', category_id: 1, description: null,
    cost_price: 20, margin_percent: 25, sale_price: 25, stock: 3, min_stock: 1, is_active: 1,
    created_at: fixedTime, updated_at: fixedTime });
  rows.customers.push({ id: 1, name: 'Cliente ficticio', is_active: 1, created_at: fixedTime, phone: null, email: null });
  rows.cash_register_periods.push({ id: 1, period_name: 'Caja noviembre', start_date: '2026-11-01', end_date: null,
    opening_cash: 100, total_cash_sales: 0, total_credit_sales: 0, total_credit_collected: 0,
    total_expenses: 0, closing_cash: null, status: 'open', version: 1, created_at: fixedTime });
  rows.cash_register_periods.push({ id: 2, period_name: 'Caja octubre', start_date: '2026-10-01', end_date: '2026-10-31',
    opening_cash: 80, total_cash_sales: 0, total_credit_sales: 0, total_credit_collected: 0,
    total_expenses: 0, closing_cash: 80, status: 'closed', version: 1, created_at: fixedTime });
  let state = { rows, counters: { categories: 1, products: 1, customers: 1, cash_register_periods: 2 }, revision: 0 };
  const handler = createHandler({ apiKey: secret, now: () => time, store: {
    read: async () => structuredClone(state),
    async commit(before, after) {
      if (state.revision !== before.revision) throw new StaleSnapshot();
      state = { ...structuredClone(after), revision: state.revision + 1 };
    },
  } });
  async function call(method, path, body, status = 200) {
    const response = await handler(event(method, path, body));
    const result = JSON.parse(response.body);
    assert.equal(response.statusCode, status, path + ': ' + JSON.stringify(result.error ?? {}));
    return result.data;
  }
  return { call, handler, read: () => state };
}

test('matches the Swagger contract and credit editing used by Electron', () => {
  const spec = JSON.parse(readFileSync(new URL('../../docs/aws-apigateway-swagger-v1.json', import.meta.url), 'utf8'));
  const normalize = path => path.replace(/\{[^}]+\}|:[a-z]+/gi, '{}');
  const expected = Object.entries(spec.paths).flatMap(([path, definition]) => Object.keys(definition)
    .filter(method => /^(get|post|put|delete)$/.test(method)).map(method => method.toUpperCase() + ' ' + normalize(path)));
  const actual = routeContracts.map(([method, path]) => method + ' ' + normalize(path));
  assert.equal(expected.length, 57);
  assert.deepEqual(actual.sort(), [...expected, 'PUT /v1/credits/{}'].sort());
});

test('rejects production, missing credentials and malformed input without touching the store', async () => {
  const handler = createHandler({ apiKey: secret, store: { read: async () => assert.fail('Unexpected read') } });
  const valid = event('GET', '/v1/products');
  assert.equal((await handler({ ...valid, requestContext: { stage: 'prod' } })).statusCode, 403);
  assert.equal((await handler({ ...valid, headers: {} })).statusCode, 403);
  assert.equal((await handler({ ...event('POST', '/v1/sales'), body: '[' })).statusCode, 422);
});

test('preserves recorded closing totals in cash history and calculates the sales summary from the ledger', async () => {
  const { call, read } = testContext();
  const closed = read().rows.cash_register_periods.find(row => row.status === 'closed');
  closed.total_credit_sales = 51.25;

  const periods = await call('GET', '/v1/cash-register/periods');
  assert.equal(periods.find(row => row.id === closed.id).total_credit_sales, 51.25);
  const summary = await call('GET', '/v1/cash-register/2/sales-summary');
  assert.equal(summary.total_credit_sales, 0);
});

test('production stays isolated and read-only until release, then recovers committed writes in order', async () => {
  const items = new Map();
  const physicalKey = (table, item) => JSON.stringify([table, item.PK.S, item.SK.S]);
  async function send(operation, input) {
    if (operation === 'GetItem') return { Item: items.get(physicalKey(input.TableName, input.Key)) };
    if (operation === 'Query') {
      const { ':pk': pk, ':prefix': prefix } = input.ExpressionAttributeValues;
      const rows = [...items].filter(([key, item]) => JSON.parse(key)[0] === input.TableName
        && pk.S === item.PK.S && (!prefix || item.SK.S.startsWith(prefix.S)));
      return { Items: rows.map(([, item]) => item) };
    }
    assert.equal(operation, 'TransactWriteItems');
    for (const { Put } of input.TransactItems) {
      if (!Put) continue;
      const old = items.get(physicalKey(Put.TableName, Put.Item));
      if (Put.ConditionExpression === 'attribute_not_exists(PK)') assert.equal(old, undefined);
      if (Put.ExpressionAttributeValues?.[':expected']) {
        assert.deepEqual(old.revision, Put.ExpressionAttributeValues[':expected']);
      }
      if (Put.ExpressionAttributeValues?.[':loading']) assert.deepEqual(old.status, Put.ExpressionAttributeValues[':loading']);
    }
    for (const { Put, Delete } of input.TransactItems) {
      if (Put) items.set(physicalKey(Put.TableName, Put.Item), Put.Item);
      else items.delete(physicalKey(Delete.TableName, Delete.Key));
    }
  }
  const apiId = 'prodtest01';
  const config = { apiId, apiKeys: [secret], now: () => fixedTime };
  const readOnly = createProductionHandler(send, config);
  const active = createProductionHandler(send, { ...config, writesEnabled: true });
  function prodEvent(method, path, body) {
    return { ...event(method, path, body), requestContext: { stage: 'prod', apiId } };
  }
  assert.equal((await readOnly(event('GET', '/v1/health'))).statusCode, 403);
  assert.equal((await readOnly({ ...prodEvent('GET', '/v1/health'), requestContext: { stage: 'prod', apiId: 'different0' } })).statusCode, 403);
  assert.equal((await readOnly(prodEvent('GET', '/v1/health'))).statusCode, 503);
  assert.equal(items.size, 0);

  const { rows, counters } = testContext().read();
  const source = { rows, sequences: Object.fromEntries(Object.keys(rows).map(table => [table, counters[table] ?? null])) };
  await importSnapshot(send, source, PRODUCTION_STORAGE);
  const health = await readOnly(prodEvent('GET', '/prod/v1/health'));
  assert.equal(health.statusCode, 200);
  assert.equal(JSON.parse(health.body).data.env, 'prod');
  assert.equal((await readOnly(prodEvent('POST', '/v1/sales'))).statusCode, 503);

  const call = async (method, path, body, status) => {
    const response = await active(prodEvent(method, path, body));
    assert.equal(response.statusCode, status, response.body);
    return JSON.parse(response.body).data;
  };
  const checkout = { sale_type: 'credit', customer_id: 1, idempotency_key: randomUUID(),
    items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  const { sale } = await call('POST', '/v1/sales', checkout, 201);
  await call('POST', '/v1/credits/1/payments', { amount: 5, idempotency_key: randomUUID() }, 201);
  await call('POST', '/v1/inventory/movements', { product_id: 1, type: 'in', quantity: 2 }, 201);
  const transfer = { operation_id: randomUUID(), sale_id: sale.id, source_id: 1, target_id: 2,
    source_version: 3, target_version: 1, sale_date: '2026-10-27' };
  await call('POST', '/v1/cash-register/transfer', transfer, 200);
  await call('POST', '/v1/cash-register/transfer', transfer, 200);

  const sourceTables = PRODUCTION_STORAGE.tables;
  const dataset = PRODUCTION_STORAGE.dataset;
  const targetTables = Object.fromEntries(Object.entries(sourceTables).map(([table, name]) => [table, `${name}-restore-test`]));
  assert.ok([...items.keys()].every(key => JSON.parse(key)[0].startsWith('michi-prod-')));
  await importSnapshot(send, source, { tables: targetTables, dataset });
  const journal = [...items.values()].filter(item => item.PK.S === RECOVERY_PARTITION);
  assert.deepEqual(journal.map(item => item.revision.N), ['2', '3', '4', '5']);
  const replay = { sourceTables, targetTables, dataset, startRevision: 1, endRevision: 5 };
  await assert.rejects(replayRecoveryJournal(send, journal.slice(1), replay), /complete journal/);
  const corrupted = structuredClone(journal);
  corrupted[3].sha256.S = 'invalid';
  await assert.rejects(replayRecoveryJournal(send, corrupted, replay), /checksum mismatch/);
  const recovered = createCollectionStore(send, { tables: targetTables, dataset });
  assert.equal((await recovered.read()).revision, 1);
  assert.equal(await replayRecoveryJournal(send, journal, replay), 5);
  const final = await createCollectionStore(send, PRODUCTION_STORAGE).read();
  assert.deepEqual(await recovered.read(), final);
  assert.equal(final.rows.sales[0].cash_register_id, 2);
  assert.equal(final.rows.credits[0].amount_paid, 5);
  assert.equal(final.rows.products[0].stock, 4);
  assert.equal(final.rows.cash_register_periods.find(row => row.id === 1).total_credit_collected, 5);
});

function testApi(t, handler) {
  t.mock.method(globalThis, 'fetch', async (requestUrl, options) => {
    const url = new URL(requestUrl);
    const result = await handler({ ...event(options.method, url.pathname + url.search),
      headers: options.headers, body: options.body });
    return new Response(result.body, { status: result.statusCode, headers: result.headers });
  });
  return new CloudApi(() => ({ baseUrl: 'https://example.invalid/test', apiKey: secret, timeoutMs: 5000, retryMax: 0 }));
}

test('runs catalog and checkout through the Electron CloudApi', async (t) => {
  const { handler, read } = testContext();
  const api = testApi(t, handler);
  assert.equal(await api.checkHealth(), true);
  const product = await api.getProductByBarcode('TEST1');
  assert.equal(product.stock, 3);
  const cart = { sale_type: 'cash', sale_date: '2026-11-26', cash_received: 50, idempotency_key: randomUUID(),
    items: [{ product_id: product.id, quantity: 1, unit_price: product.sale_price }] };
  const sale = await api.createSale(cart);
  assert.equal(sale.total, 25);
  assert.equal(sale.cash_change, 25);
  assert.equal(sale.created_at, fixedTime);
  assert.equal((await api.createSale(cart)).id, sale.id);
  assert.equal((await api.getProductById(1)).stock, 2);
  assert.equal((await api.getCurrentCashRegister()).total_cash_sales, 25);
  assert.equal((await api.getSaleDetailById(sale.id)).items[0].product_name, product.name);
  assert.equal(read().rows.inventory_movements.length, 1);
  await assert.rejects(api.createSale({ ...cart, cash_received: 60 }));
  assert.equal(await api.deleteSale(sale.id), true);
  assert.equal((await api.getProductById(1)).stock, 3);
  assert.equal((await api.getCurrentCashRegister()).total_cash_sales, 0);
});

test('catalog edits preserve omitted fields and clear explicitly nullable fields', async (t) => {
  const { handler } = testContext();
  const api = testApi(t, handler);
  const category = await api.createCategory({ name: 'Hija', parent_id: 1 });
  assert.equal((await api.updateCategory(category.id, { name: 'Hija editada' })).parent_id, 1);
  assert.equal((await api.updateCategory(category.id, { parent_id: null })).parent_id, null);
  const assigned = await api.updateProduct(1, { category_id: category.id, description: 'Descripción' });
  assert.deepEqual([assigned.category_id, assigned.description], [category.id, 'Descripción']);
  const renamed = await api.updateProduct(1, { name: 'Cuaderno editado' });
  assert.deepEqual([renamed.category_id, renamed.description], [category.id, 'Descripción']);
  const cleared = await api.updateProduct(1, { category_id: null, description: null });
  assert.deepEqual([cleared.category_id, cleared.description], [null, null]);
  await assert.rejects(api.updateCategory('1/../../settings', { parent_id: null }), /ID de categoría/);
  await assert.rejects(api.updateProduct(0, { category_id: null }), /ID de producto/);
});

test('credit surcharge, partial payment and retry conserve cash and credit', async () => {
  const { call } = testContext();
  const historical = await call('POST', '/v1/cash-register/historical-sale', {
    sale_type: 'credit', customer_id: 1, cash_register_id: 2, sale_date: '2026-10-25',
    credit_days: 5, surcharge_percent: 10, initial_payment: 5, idempotency_key: randomUUID(),
    items: [{ product_id: 1, quantity: 2, unit_price: 25 }],
  }, 201);
  assert.equal(historical.sale.total, 50);
  assert.deepEqual(await call('POST', '/v1/credits/recalculate-overdue'), { updated_count: 1 });
  assert.deepEqual(await call('POST', '/v1/credits/recalculate-overdue'), { updated_count: 0 });
  const payment = { amount: 50, idempotency_key: randomUUID() };
  const created = await call('POST', '/v1/credits/1/payments', payment, 201);
  assert.equal(created.credit.status, 'paid');
  assert.equal(created.credit.total_due, 55);
  assert.equal(created.credit.amount_paid, 55);
  assert.equal((await call('POST', '/v1/credits/1/payments', payment)).created, false);
  assert.equal((await call('GET', '/v1/cash-register/1/sales-summary')).total_credit_collected, 50);
  assert.equal((await call('GET', '/v1/cash-register/2/sales-summary')).total_credit_collected, 5);
  assert.equal((await call('GET', '/v1/sales/' + historical.sale.id)).surcharge, 5);
});

test('creates and retires synthetic catalog and customer records without dangling references', async () => {
  const { call } = testContext();
  const category = await call('POST', '/v1/categories', { name: 'Subcategoría', parent_id: 1 }, 201);
  await call('PUT', '/v1/categories/1', { parent_id: category.id }, 409);
  const customer = await call('POST', '/v1/customers', { name: 'Cliente del ensayo', phone: '' }, 201);
  const product = await call('POST', '/v1/products', {
    name: 'Hoja de ensayo', barcode: 'TEST2', category_id: category.id, cost_price: 2.01, margin_percent: 50,
  }, 201);
  assert.equal(product.sale_price, 3.02);
  await call('POST', '/v1/products', { name: 'Duplicado', barcode: 'TEST2', cost_price: 1 }, 409);
  await call('PUT', '/v1/products/' + product.id, { min_stock: 1, description: 'Hoja' });
  await call('POST', '/v1/inventory/movements', { product_id: product.id, type: 'in', quantity: 1.5 }, 201);
  assert.equal((await call('GET', '/v1/products/' + product.id)).stock, 1.5);
  await call('DELETE', '/v1/categories/' + category.id);
  assert.equal((await call('GET', '/v1/products/' + product.id)).category_id, null);
  assert.equal((await call('DELETE', '/v1/customers/' + customer.id)).deleted, true);
  assert.equal((await call('GET', '/v1/customers/' + customer.id)).is_active, 0);
  assert.equal((await call('DELETE', '/v1/products/' + product.id + '/permanent')).deleted, true);
  assert.equal(await call('GET', '/v1/products/' + product.id), null);
});

test('closes cash and accepts a future opening when periods do not overlap', async () => {
  const { call } = testContext();
  const deposit = await call('POST', '/v1/cash-register/movements', {
    cash_register_id: 1, type: 'deposit', amount: 20, idempotency_key: randomUUID(),
  }, 201);
  await call('PUT', '/v1/cash-register/movements/' + deposit.id, { amount: 25 });
  assert.equal((await call('GET', '/v1/cash-register/1/movements'))[0].amount, 25);
  await call('DELETE', '/v1/cash-register/movements/' + deposit.id);
  await call('POST', '/v1/sales', {
    sale_type: 'credit', customer_id: 1, credit_days: 5, surcharge_percent: 10,
    idempotency_key: randomUUID(), items: [{ product_id: 1, quantity: 1, unit_price: 25 }],
  }, 201);
  assert.equal((await call('PUT', '/v1/credits/1', { due_date: '2026-12-07' })).due_date, '2026-12-07');
  assert.equal((await call('GET', '/v1/credits/summary')).totalPending, 25);
  assert.equal((await call('POST', '/v1/cash-register/close', {
    id: 1, closing_cash: 100, end_date: '2026-11-26',
  })).status, 'closed');
  assert.equal(await call('GET', '/v1/cash-register/current'), null);
  await call('POST', '/v1/cash-register/open', { period_name: 'Periodo solapado', start_date: '2026-11-26', opening_cash: 100 }, 409);
  const opened = await call('POST', '/v1/cash-register/open', {
    period_name: 'Periodo nuevo', start_date: '2026-11-27', opening_cash: 100,
  }, 201);
  const current = await call('GET', '/v1/cash-register/current');
  assert.deepEqual([current.id, current.status, current.start_date, current.opening_cash],
    [opened.id, 'open', '2026-11-27', 100]);
  await call('POST', '/v1/sales', {
    sale_type: 'cash', cash_received: 25, items: [{ product_id: 1, quantity: 1, unit_price: 25 }],
  }, 409);
  assert.equal((await call('GET', '/v1/cash-register/periods')).filter(row => row.status === 'closed').length, 2);
});

test('reporting, approval invariants, cash correction and sale transfer', async () => {
  const { call } = testContext();
  await call('POST', '/v1/products', { name: 'Huérfano', barcode: 'FAKE', category_id: 999, cost_price: 4 }, 404);
  await call('POST', '/v1/inventory/movements', { type: 'out', product_id: 1, quantity: 4 }, 409);
  const sale = await call('POST', '/v1/sales', {
    sale_type: 'cash', cash_received: 25, idempotency_key: randomUUID(),
    items: [{ product_id: 1, quantity: 1, unit_price: 25 }],
  }, 201);
  const transfer = { operation_id: randomUUID(), sale_id: sale.sale.id, source_id: 1, target_id: 2,
    source_version: 2, target_version: 1, sale_date: '2026-10-27' };
  assert.equal(await call('POST', '/v1/cash-register/transfer', transfer), true);
  assert.equal(await call('POST', '/v1/cash-register/transfer', transfer), true);
  assert.equal((await call('GET', '/v1/cash-register/2/sales-summary')).total_cash_sales, 25);
  assert.equal((await call('GET', '/v1/cash-register/current')).total_cash_sales, 0);
  assert.equal((await call('GET', '/v1/products/1')).stock, 2);
  const correction = { operation_id: randomUUID(), id: 2, version: 2, start_date: '2026-10-01',
    end_date: '2026-10-31', opening_cash: 80, closing_cash: 105 };
  assert.equal(await call('POST', '/v1/cash-register/correct', correction), true);
  assert.equal((await call('GET', '/v1/reports/sales-by-date?start_date=2026-10-01&end_date=2026-10-31'))[0].total, 25);
  assert.equal((await call('GET', '/v1/reports/inventory-summary')).total_stock_units, 2);
  assert.equal((await call('GET', '/v1/reports/profit?start_date=2026-10-01&end_date=2026-10-31'))[0].profit, 5);
});

test('DynamoDB adapter detects concurrent writes and keeps settings in the prototype', async () => {
  const writeCalls = [];
  const store = createDynamoStore(async (operation, args) => {
    if (operation === 'GetItem') return {};
    if (operation === 'Scan') {
      assert.match(args.TableName, /^michi-poc-/);
      assert.equal(args.ConsistentRead, true);
      if (args.TableName === 'michi-poc-settings') return { Items: [{
        entityType: { S: 'COUNTER_STATE' }, lastAssignedId: { M: {} },
      }] };
      return { Items: [] };
    }
    writeCalls.push(args.TransactItems);
    if (writeCalls.length > 1) throw Object.assign(new Error('changed'), {
      name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });
    return {};
  });
  const before = await store.read();
  const after = structuredClone(before);
  after.rows.settings.push({ key: 'store_name', value: 'Tienda sintética' });
  await store.commit(before, after);
  assert.equal(writeCalls[0].length, 2);
  assert.equal(writeCalls[0][0].Put.TableName, 'michi-poc-settings');
  assert.equal(writeCalls[0][1].Put.ConditionExpression, 'attribute_not_exists(PK)');
  await assert.rejects(store.commit(before, after), StaleSnapshot);
});

test('rounds half-cent sale lines before summing and preserves fractional stock', async () => {
  const { call, read } = testContext();
  const firstProduct = read().rows.products[0];
  read().rows.products.push({ ...firstProduct, id: 2, barcode: 'TEST2', cost_price: 12, sale_price: 15 });
  const { sale } = await call('POST', '/v1/sales', {
    sale_type: 'cash', cash_received: 0.10, idempotency_key: randomUUID(),
    items: [
      { product_id: 1, quantity: 0.001, unit_price: 25 },
      { product_id: 2, quantity: 0.001, unit_price: 15 },
    ],
  }, 201);
  assert.deepEqual([sale.subtotal, sale.total, sale.cash_change], [0.05, 0.05, 0.05]);
  const detail = await call('GET', '/v1/sales/' + sale.id + '/detail');
  assert.deepEqual(detail.items.map(item => [item.quantity, item.line_total]), [[0.001, 0.03], [0.001, 0.02]]);
  assert.deepEqual(read().rows.products.map(product => product.stock), [2.999, 2.999]);
  assert.equal((await call('GET', '/v1/cash-register/current')).total_cash_sales, 0.05);
});

test('an invalid second line leaves all parts of checkout unchanged', async () => {
  const { call, read } = testContext();
  read().rows.products.push({ ...read().rows.products[0], id: 2, barcode: 'TEST2', stock: 1 });
  const before = structuredClone(read());
  const original = { product_id: 1, quantity: 1, unit_price: 25 };
  const second = { product_id: 2, quantity: 1, unit_price: 25 };
  for (const [items, status] of [
    [[original, { ...second, quantity: 2 }], 409],
    [[original, { ...second, unit_price: 24.99 }], 409],
    [[original, { ...original }], 422],
    [[original, { ...second, quantity: 0.0001 }], 422],
  ]) {
    await call('POST', '/v1/sales', { sale_type: 'cash', cash_received: 100, items }, status);
    assert.deepEqual(read(), before);
  }
  await call('POST', '/v1/sales', {
    sale_type: 'cash', cash_received: 49.99, items: [original, second],
  }, 422);
  assert.deepEqual(read(), before);
});

test('checkout uses the Mexico business day across UTC midnight', async () => {
  const utcNextDay = '2026-11-27T03:59:59.999Z';
  const { call, read } = testContext({ time: utcNextDay });
  const saleBody = { sale_type: 'cash', cash_received: 25, items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  const before = structuredClone(read());
  await call('POST', '/v1/sales', { ...saleBody, sale_date: '2026-11-27' }, 422);
  await call('POST', '/v1/sales', { ...saleBody, sale_date: '2026-11-31' }, 422);
  await call('POST', '/v1/sales', { ...saleBody, sale_date: '2026-10-31' }, 409);
  assert.deepEqual(read(), before);
  const { sale } = await call('POST', '/v1/sales', { ...saleBody, sale_date: '2026-11-26' }, 201);
  assert.deepEqual([sale.created_at, sale.captured_at, sale.cash_register_id], [utcNextDay, utcNextDay, 1]);
});

test('sales, credits and reports use the configured business day across UTC midnight', async (t) => {
  const { handler } = testContext({ time: '2026-11-27T05:30:00.000Z' });
  const api = testApi(t, handler);
  const businessDate = '2026-11-26';
  const utcDate = '2026-11-27';
  const cart = { sale_date: businessDate, items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  await api.createSale({ ...cart, sale_type: 'cash', cash_received: 25 });
  await api.createSale({ ...cart, sale_type: 'credit', customer_id: 1 });
  const page = { page: 1, pageSize: 10, dateFrom: businessDate, dateTo: businessDate };
  assert.equal((await api.getSalesPaginated(page)).total, 2);
  assert.equal((await api.getSalesSummary(page)).totalRevenue, 50);
  assert.equal((await api.getCreditsPaginated(page)).total, 1);
  assert.equal((await api.getCreditsSummary(page)).totalPending, 25);
  assert.deepEqual(await api.getSalesByDate(businessDate, businessDate), [
    { date: businessDate, count: 2, total_cash: 25, total_credit: 25, total: 50 },
  ]);
  assert.equal((await api.getTopProducts(businessDate, businessDate))[0].total_revenue, 50);
  assert.equal((await api.getProfitReport(businessDate, businessDate))[0].profit, 10);
  assert.deepEqual(await api.getSalesByDate(utcDate, utcDate), []);

  await api.updateSettingsSection('credits', { business_timezone: 'UTC' });
  assert.equal((await api.getSalesPaginated(page)).total, 0);
  assert.equal((await api.getSalesByDate(utcDate, utcDate))[0].total, 50);
  assert.equal((await api.getCreditsPaginated({ ...page, dateFrom: utcDate, dateTo: utcDate })).total, 1);
});

test('sales and inventory pagination can reach records beyond the first 500', async (t) => {
  const { handler, read } = testContext();
  const api = testApi(t, handler);
  const { sales, inventory_movements: movements } = read().rows;
  for (let id = 1; id <= 501; id += 1) {
    sales.push({ id, sale_type: 'cash', cash_register_id: 1, total: 25, created_at: fixedTime });
    movements.push({ id, product_id: 1, type: 'in', quantity: 1, created_at: fixedTime });
  }
  const query = { page: 51, pageSize: 10 };
  for (const page of [await api.getSalesPaginated(query), await api.getInventoryMovementsPaginated(query)]) {
    assert.equal(page.total, 501);
    assert.deepEqual(page.items.map(item => item.id), [1]);
  }
});

test('only one checkout can reserve the last item', async () => {
  const { handler, read } = testContext();
  read().rows.products[0].stock = 1;
  const body = { sale_type: 'cash', cash_received: 25, items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  const responses = await Promise.all(['checkout-a', 'checkout-b'].map(
    idempotency_key => handler(event('POST', '/v1/sales', { ...body, idempotency_key })),
  ));
  assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409]);
  const { rows } = read();
  assert.deepEqual([rows.sales.length, rows.sale_items.length, rows.inventory_movements.length], [1, 1, 1]);
  assert.equal(rows.products[0].stock, 0);
  assert.equal(rows.cash_register_periods.find(row => row.id === 1).total_cash_sales, 25);
});

test('settles a credit once and rejects a retry with changed payment data', async () => {
  const { call, read } = testContext();
  await call('POST', '/v1/sales', {
    sale_type: 'credit', customer_id: 1, initial_payment: 5,
    items: [{ product_id: 1, quantity: 1, unit_price: 25 }],
  }, 201);
  const payment = { amount: 20, payment_date: '2026-11-26', idempotency_key: randomUUID() };
  const settled = await call('POST', '/v1/credits/1/payments', payment, 201);
  assert.deepEqual([settled.credit.status, settled.credit.total_due, settled.credit.amount_paid], ['paid', 25, 25]);
  const before = structuredClone(read().rows);
  const again = await call('POST', '/v1/credits/1/payments', payment);
  assert.equal(again.created, false);
  await call('POST', '/v1/credits/1/payments', { ...payment, amount: 21 }, 409);
  await call('POST', '/v1/credits/1/payments', { amount: 0.01, idempotency_key: randomUUID() }, 409);
  assert.deepEqual(read().rows, before);
  assert.deepEqual(before.credit_payments.map(item => item.amount), [5, 20]);
  assert.equal(before.cash_register_periods.find(row => row.id === 1).total_credit_collected, 25);
});

test('reversing a historical credit removes its receipts from both cash periods', async () => {
  const { call, read } = testContext();
  const captured = await call('POST', '/v1/cash-register/historical-sale', {
    sale_type: 'credit', customer_id: 1, cash_register_id: 2, sale_date: '2026-10-31', initial_payment: 5,
    items: [{ product_id: 1, quantity: 1, unit_price: 25 }],
  }, 201);
  await call('POST', '/v1/credits/1/payments', { amount: 10, idempotency_key: randomUUID() }, 201);
  assert.deepEqual(read().rows.cash_register_periods.map(row => row.total_credit_collected), [10, 5]);
  assert.deepEqual(await call('DELETE', '/v1/sales/' + captured.sale.id), { deleted: true });
  const { rows } = read();
  assert.deepEqual([rows.sales.length, rows.sale_items.length, rows.credits.length, rows.credit_payments.length], [0, 0, 0, 0]);
  assert.equal(rows.products[0].stock, 3);
  assert.deepEqual(rows.inventory_movements.map(row => [row.type, row.quantity]), [['out', -1], ['in', 1]]);
  assert.deepEqual(rows.cash_register_periods.map(row => [row.total_credit_sales, row.total_credit_collected]),
    [[0, 0], [0, 0]]);
});

test('counts the revision record in the 100-item transaction limit', async () => {
  const writes = [];
  const store = createDynamoStore(async (operation, args) => {
    if (operation === 'GetItem') return {};
    if (operation === 'Scan') return args.TableName === 'michi-poc-settings'
      ? { Items: [{ entityType: { S: 'COUNTER_STATE' }, lastAssignedId: { M: {} } }] }
      : { Items: [] };
    assert.equal(operation, 'TransactWriteItems');
    writes.push(args.TransactItems);
    return {};
  });
  const prior = await store.read();
  const atLimit = structuredClone(prior);
  atLimit.rows.settings = Array.from({ length: 99 }, (_, i) => ({ key: 'fixture-' + i, value: 'synthetic' }));
  await store.commit(prior, atLimit);
  assert.equal(writes[0].length, 100);
  assert.equal(writes[0].at(-1).Put.Item.entityType.S, 'PROTOTYPE_VERSION');
  const overflow = structuredClone(atLimit);
  overflow.rows.settings.push({ key: 'over-limit', value: 'synthetic' });
  await assert.rejects(store.commit(prior, overflow), PrototypeLimit);
  assert.equal(writes.length, 1);
});

test('the adapter rejects a snapshot when the revision changes during reads', async () => {
  let revision = 4;
  const store = createDynamoStore(async (operation, args) => {
    if (operation === 'GetItem') return { Item: { dataset: { S: DATASET }, revision: { N: String(revision++) } } };
    assert.equal(operation, 'Scan');
    assert.equal(args.ConsistentRead, true);
    return { Items: [] };
  });
  await assert.rejects(store.read(), StaleSnapshot);
});

test('the adapter follows empty filtered pages and retries timed-out reads once', async () => {
  let versionReads = 0;
  let continuations = 0;
  let writes = 0;
  const lastKey = { PK: { S: 'PAGE' }, SK: { S: 'MARKER' } };
  const timeout = Object.assign(new Error('Read timed out'), { name: 'TimeoutError' });
  const store = createDynamoStore(async (operation, args) => {
    if (operation === 'TransactWriteItems') {
      writes += 1;
      throw timeout;
    }
    assert.equal(args.ConsistentRead, true);
    if (operation === 'GetItem') {
      versionReads += 1;
      if (versionReads === 1) throw timeout;
      return {};
    }
    assert.equal(operation, 'Scan');
    if (args.TableName === 'michi-poc-settings') {
      return { Items: [{ entityType: { S: 'COUNTER_STATE' }, lastAssignedId: { M: {} } }] };
    }
    if (args.TableName !== 'michi-poc-operations') return { Items: [] };
    if (!args.ExclusiveStartKey) return { Items: [], LastEvaluatedKey: lastKey };
    assert.deepEqual(args.ExclusiveStartKey, lastKey);
    continuations += 1;
    if (continuations === 1) throw timeout;
    return { Items: [{ sourceTable: { S: 'sales' }, id: { N: '501' }, totalCents: { N: '2500' } }] };
  });
  const prior = await store.read();
  assert.deepEqual(prior.rows.sales, [{ id: 501, total: 25 }]);
  assert.deepEqual([versionReads, continuations], [3, 2]);
  const after = structuredClone(prior);
  after.rows.settings.push({ key: 'test', value: 'fixture' });
  await assert.rejects(store.commit(prior, after), { name: 'TimeoutError' });
  assert.equal(writes, 1);

  let attempts = 0;
  const unavailable = createDynamoStore(async () => {
    attempts += 1;
    throw timeout;
  });
  await assert.rejects(unavailable.read(), { name: 'TimeoutError' });
  assert.equal(attempts, 2);
});

test('keyed routes avoid scans, paginate related rows and enforce dataset and revision boundaries', async () => {
  const { call, read } = testContext();
  const original = read().rows.products[0];
  read().rows.products.push({ ...original, id: 2, name: 'Segundo producto', barcode: 'TEST2' });
  const created = await call('POST', '/v1/sales', {
    sale_type: 'credit', customer_id: 1, items: [1, 2].map(product_id => ({ product_id, quantity: 1, unit_price: 25 })),
  }, 201);
  const items = new Map();
  const requests = [];
  let foreignProduct = false;
  let changingRevision = false;
  let versions = 0;
  const keyOf = (table, item) => JSON.stringify([table, item.PK.S, item.SK.S]);
  const store = createDynamoStore(async (operation, args) => {
    requests.push([operation, args]);
    if (operation === 'TransactWriteItems') {
      for (const { Put } of args.TransactItems) items.set(keyOf(Put.TableName, Put.Item), Put.Item);
      return {};
    }
    assert.equal(args.ConsistentRead, true);
    if (operation === 'GetItem') {
      const item = items.get(keyOf(args.TableName, args.Key));
      if (changingRevision && args.Key.PK.S === 'PROTOTYPE#FULL' && ++versions > 1) {
        return { Item: { ...item, revision: { N: '2' } } };
      }
      if (foreignProduct && args.Key.PK.S === 'PRODUCT#1') {
        return { Item: { ...item, dataset: { S: 'another-dataset' } } };
      }
      return { Item: item };
    }
    assert.equal(operation, 'Query');
    const matching = [...items.values()].filter(item => item.PK.S === args.ExpressionAttributeValues[':pk'].S
      && item.SK.S.startsWith(args.ExpressionAttributeValues[':prefix'].S));
    if (args.ExclusiveStartKey) return { Items: matching.slice(1) };
    const [first] = matching;
    return { Items: matching.slice(0, 1), ...(matching.length > 1 ? { LastEvaluatedKey: { PK: first.PK, SK: first.SK } } : {}) };
  });
  await store.commit({ rows: emptyRows(), counters: {}, revision: 0 }, read());
  requests.length = 0;
  const handler = createHandler({ store, apiKey: secret, now: () => fixedTime });
  async function get(path) {
    const response = await handler(event('GET', path));
    return { status: response.statusCode, ...JSON.parse(response.body) };
  }

  assert.equal((await get('/v1/products/1')).data.name, original.name);
  assert.deepEqual(requests.map(([operation]) => operation), ['GetItem']);
  foreignProduct = true;
  assert.equal((await get('/v1/products/1')).data, null);
  foreignProduct = false;

  const detailPath = '/v1/sales/' + created.sale.id + '/detail';
  const detail = (await get(detailPath)).data;
  assert.equal(detail.customer_name, 'Cliente ficticio');
  assert.deepEqual(detail.items.map(item => item.product_name), [original.name, 'Segundo producto']);
  assert.equal(requests.filter(([operation]) => operation === 'Query').length, 2);

  changingRevision = true;
  const stale = await get(detailPath);
  assert.equal(stale.status, 409);
  assert.equal(stale.data, undefined);
  assert.equal(requests.some(([operation]) => operation === 'Scan'), false);
});

test('the adapter keeps legacy nulls and rejects IDs outside the safe integer range', async () => {
  let identifier = '301';
  const store = createDynamoStore(async (operation, args) => {
    if (operation === 'GetItem') return {};
    assert.equal(operation, 'Scan');
    if (args.TableName === 'michi-poc-settings') {
      return { Items: [{ entityType: { S: 'COUNTER_STATE' }, lastAssignedId: { M: {} } }] };
    }
    if (args.TableName === 'michi-poc-operations') {
      return { Items: [{ sourceTable: { S: 'sales' }, id: { N: identifier },
        capturedAt: { NULL: true }, cashRegisterId: { NULL: true }, totalCents: { N: '2500' } }] };
    }
    return { Items: [] };
  });
  assert.deepEqual((await store.read()).rows.sales, [{ id: 301, captured_at: null, cash_register_id: null, total: 25 }]);
  identifier = '9007199254740993';
  await assert.rejects(store.read(), /Unsafe number/);
});

test('a late retry does not recreate a reversed sale', async () => {
  const { call, handler, read } = testContext();
  const payload = { sale_type: 'cash', sale_date: '2026-11-26', cash_received: 25,
    idempotency_key: 'late-retry-of-reversed-sale', items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  const initial = await call('POST', '/v1/sales', payload, 201);
  assert.deepEqual(await call('DELETE', '/v1/sales/' + initial.sale.id), { deleted: true });
  assert.equal(read().rows.products[0].stock, 3);
  assert.equal(read().rows.cash_register_periods[0].total_cash_sales, 0);
  const afterReversal = structuredClone(read());
  for (const retry of [payload, { ...payload, cash_received: 50 }]) {
    const replay = await handler(event('POST', '/v1/sales', retry));
    assert.equal(replay.statusCode, 409);
    assert.equal(JSON.parse(replay.body).error.code, 'business_conflict');
    assert.deepEqual(read(), afterReversal);
  }
  const newSale = await call('POST', '/v1/sales', { ...payload, idempotency_key: randomUUID() }, 201);
  assert.notEqual(newSale.sale.id, initial.sale.id);
});

test('persists the reversal marker in the sale transaction and rejects retries after a fresh read', async () => {
  const { call, read } = testContext();
  const payload = { sale_type: 'cash', cash_received: 25, idempotency_key: 'persisted-reversed-sale',
    items: [{ product_id: 1, quantity: 1, unit_price: 25 }] };
  const { sale } = await call('POST', '/v1/sales', payload, 201);
  const before = structuredClone(read());
  await call('DELETE', '/v1/sales/' + sale.id);
  const after = read();

  let writes;
  const store = createDynamoStore(async (operation, args) => {
    assert.equal(operation, 'TransactWriteItems');
    assert.equal(writes, undefined);
    writes = args.TransactItems;
    return {};
  });
  await store.commit(before, after);
  const idempotencyPk = 'IDEMPOTENCY#sales#' + payload.idempotency_key;
  const keyWrites = writes.filter(change => (change.Put?.Item ?? change.Delete?.Key)?.PK.S === idempotencyPk);
  assert.equal(keyWrites.length, 1);
  assert.equal(keyWrites[0].Put.TableName, 'michi-poc-operations');
  const marker = keyWrites[0].Put.Item;
  assert.equal(marker.SK.S, 'RESULT');
  assert.equal(marker.status.S, 'reversed');
  assert.ok(writes.some(change => change.Delete?.Key.PK.S === `SALE#${sale.id}` && change.Delete.Key.SK.S === 'META'));
  assert.ok(writes.some(change => change.Put?.Item.stockMilli?.N === '3000'));
  assert.ok(writes.some(change => change.Put?.Item.totalCashSalesCents?.N === '0'));
  const revision = writes.at(-1).Put;
  assert.equal(revision.Item.revision.N, String(after.revision));
  assert.equal(revision.ExpressionAttributeValues[':expected'].N, String(before.revision));

  const reloaded = createDynamoStore(async (operation, args) => {
    if (operation === 'GetItem') return { Item: revision.Item };
    assert.equal(operation, 'Scan', 'Blocked retries must not write to DynamoDB');
    if (args.TableName === 'michi-poc-operations') return { Items: [marker] };
    if (args.TableName === 'michi-poc-settings') {
      return { Items: [{ entityType: { S: 'COUNTER_STATE' }, lastAssignedId: { M: {} } }] };
    }
    return { Items: [] };
  });
  assert.deepEqual((await reloaded.read()).reversedSales, after.reversedSales);
  const handler = createHandler({ store: reloaded, apiKey: secret, now: () => fixedTime });
  const replay = await handler(event('POST', '/v1/sales', payload));
  assert.equal(replay.statusCode, 409);
  assert.equal(JSON.parse(replay.body).error.message, 'La venta original ya fue revertida');
});
