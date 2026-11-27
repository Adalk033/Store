import {
  CONTROL, DATASET, TABLES, PrototypeLimit, StaleSnapshot, createDynamoStore, decodeItem, emptyRows,
  encodeItem, encodeSnapshot, fieldsFromItem, rowKey,
} from './store.mjs';
import { recoveryEntry } from './recovery.mjs';

const PATTERNS = [
  ['categories', 'CATEGORY#', 'META'], ['products', 'PRODUCT#', 'META'],
  ['customers', 'CUSTOMER#', 'META'], ['cash_register_periods', 'CASH#', 'META'],
  ['cash_register_corrections', 'OPERATION#', 'AUDIT'], ['sales', 'SALE#', 'META'],
  ['sale_items', 'SALE#', 'ITEM#'], ['credits', 'CREDIT#', 'META'],
  ['credit_payments', 'CREDIT#', 'PAYMENT#'], ['inventory_movements', 'PRODUCT#', 'MOVEMENT#'],
  ['cash_movements', 'CASH#', 'MOVEMENT#'], ['settings', 'SETTING#', 'VALUE'],
  ['data_versions', 'VERSION#', 'META'],
];
const REQUESTS = 'INDEX#sales_requests';
const CASH_LEDGER = ['sales', 'credit_payments', 'cash_movements'];

const SELECTIONS = {
  'GET /health': [],
  'GET /settings/sections/:section': ['settings'],
  'PUT /settings/sections/:section': ['settings'],
  'GET /categories': ['categories'],
  'POST /categories': ['categories'],
  'PUT /categories/:id': ['categories'],
  'DELETE /categories/:id': ['categories', 'products'],
  'GET /products': ['products'],
  'GET /products/low-stock': ['products'],
  'GET /products/:id/can-delete-permanently': ['sale_items'],
  'POST /products': ['categories'],
  'PUT /products/:id': ['categories'],
  'DELETE /products/:id': [],
  'DELETE /products/:id/permanent': ['sale_items'],
  'GET /customers': ['customers', 'credits'],
  'POST /customers': [],
  'PUT /customers/:id': ['credits'],
  'DELETE /customers/:id': ['credits'],
  'GET /customers/:id/credits': ['credits', 'settings'],
  'GET /inventory/movements': ['inventory_movements', 'products'],
  'POST /inventory/movements': [],
  'GET /cash-register/periods': ['cash_register_periods', ...CASH_LEDGER],
  'POST /cash-register/open': ['cash_register_periods'],
  'POST /cash-register/close': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'POST /cash-register/correct': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'POST /cash-register/transfer': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'POST /cash-register/historical-sale': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'POST /cash-register/movements': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'PUT /cash-register/movements/:id': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'DELETE /cash-register/movements/:id': ['cash_register_periods', ...CASH_LEDGER],
  'GET /cash-register/:id/sales': ['sales', 'sale_items', 'customers', 'settings'],
  'GET /cash-register/:id/credit-payments': ['credit_payments', 'credits', 'customers'],
  'GET /cash-register/:id/sales-summary': CASH_LEDGER,
  'POST /sales': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'GET /sales': ['sales', 'sale_items', 'customers', 'settings'],
  'DELETE /sales/:id': ['cash_register_periods', ...CASH_LEDGER],
  'GET /sales/summary': ['sales', 'sale_items', 'customers', 'settings'],
  'GET /credits': ['credits', 'customers', 'settings'],
  'POST /credits/:id/payments': ['cash_register_periods', 'settings', ...CASH_LEDGER],
  'PUT /credits/:id': ['cash_register_periods', ...CASH_LEDGER],
  'POST /credits/recalculate-overdue': ['credits', 'cash_register_periods', 'settings', ...CASH_LEDGER],
  'GET /credits/summary': ['credits', 'customers', 'settings'],
  'GET /reports/sales-by-date': ['sales', 'settings'],
  'GET /reports/top-products': ['sales', 'sale_items', 'products', 'settings'],
  'GET /reports/profit': ['sales', 'sale_items', 'products', 'settings'],
  'GET /reports/inventory': ['products'],
  'GET /reports/inventory-summary': ['products'],
  'GET /reports/credits-overview': ['credits'],
};
const PRODUCT_ROUTES = new Set(['PUT /products/:id', 'DELETE /products/:id',
  'DELETE /products/:id/permanent', 'GET /products/:id/can-delete-permanently']);
const CUSTOMER_ROUTES = new Set(['PUT /customers/:id', 'DELETE /customers/:id', 'GET /customers/:id/credits']);
const CREDIT_ROUTES = new Set(['POST /credits/:id/payments', 'PUT /credits/:id']);
const CHECKOUT_ROUTES = new Set(['POST /sales', 'POST /cash-register/historical-sale']);
const CORRECTION_ROUTES = new Set(['POST /cash-register/correct', 'POST /cash-register/transfer']);

function partition(table) {
  return `ROWS#${table}`;
}

function physicalKey(tables, tableName, { PK, SK }) {
  const pattern = PATTERNS.find(([table, pk, sk]) => tables[table] === tableName
    && PK.startsWith(pk) && (sk.endsWith('#') ? SK.startsWith(sk) : SK === sk));
  if (pattern) return { PK: partition(pattern[0]), SK: `${PK}|${SK}` };
  if (PK.startsWith('IDEMPOTENCY#sales#') && SK === 'RESULT') return { PK: REQUESTS, SK: PK };
  return { PK, SK };
}

function wireKey(tables, tableName, item) {
  return encodeItem(physicalKey(tables, tableName, { PK: item.PK.S, SK: item.SK.S }));
}

export function encodeCollectionSnapshot(state, { tables = TABLES, dataset = DATASET } = {}) {
  return encodeSnapshot(state, { tables, dataset }).map(({ table, item }) => ({
    table, item: { ...item, ...wireKey(tables, table, item) },
  }));
}

function reverseMarker(item) {
  const { idempotencyKey, entityId, requestHash, reversedAt } = item;
  return { idempotencyKey, entityId, requestHash, reversedAt };
}

function identifier(value) {
  return typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
}

export function createCollectionStore(send, { tables = TABLES, dataset = DATASET, recordWrites = false } = {}) {
  const operations = tables.sales;
  async function read(operation, input) {
    try { return await send(operation,input); }
    catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      return send(operation,input);
    }
  }

  const legacy = createDynamoStore((operation, args) => {
    if (operation === 'GetItem') return send(operation, { ...args, Key:wireKey(tables,args.TableName,args.Key) });
    if (operation === 'Query') {
      const pk = args.ExpressionAttributeValues[':pk'].S;
      const prefix = args.ExpressionAttributeValues[':prefix'].S;
      const key = physicalKey(tables, args.TableName, { PK: pk, SK: prefix });
      return send(operation, { ...args, ExpressionAttributeValues: encodeItem({ ':pk':key.PK, ':prefix':key.SK }) });
    }
    if (operation !== 'TransactWriteItems') throw new TypeError('Invalid collection operation');
    const changes = args.TransactItems.map(change => {
      if (change.Put) {
        const { TableName, Item } = change.Put;
        return { Put: { ...change.Put, Item: {...Item, ...wireKey(tables,TableName,Item)} } };
      }
      const { TableName, Key } = change.Delete;
      return { Delete: { ...change.Delete, Key:wireKey(tables,TableName,Key) } };
    });
    if (recordWrites) {
      if (changes.length >= 100) throw new PrototypeLimit();
      changes.push(recoveryEntry(operations, dataset, changes));
    }
    return send(operation, { TransactItems: changes });
  }, { tables, dataset });

  async function get(tableName, key) {
    const result = await read('GetItem',{ TableName:tableName, Key:encodeItem(key), ConsistentRead:true });
    return result.Item?.dataset?.S === dataset ? decodeItem(result.Item) : undefined;
  }

  async function query(tableName, pk, prefix) {
    const items = [];
    let key;
    do {
      const result = await read('Query',{TableName:tableName, ConsistentRead:true,
        KeyConditionExpression:prefix ? 'PK = :pk AND begins_with(SK, :prefix)' : 'PK = :pk',
        ExpressionAttributeValues:encodeItem(prefix ? {':pk':pk, ':prefix':prefix} : {':pk':pk}),
        ...(key ? {ExclusiveStartKey:key} : {}),
      });
      items.push(...(result.Items ?? []).filter(item => item.dataset?.S === dataset).map(decodeItem));
      key = result.LastEvaluatedKey;
    } while (key && Object.keys(key).length);
    return items;
  }

  async function row(table,id) {
    const numeric = identifier(id);
    if (!Number.isSafeInteger(numeric) || numeric < 1) return;
    const tableName = tables[table];
    const item = await get(tableName,physicalKey(tables,tableName,rowKey(table,{id:numeric})));
    return item?.sourceTable === table ? fieldsFromItem(item) : undefined;
  }
  async function rowsFor(table,prefix) {
    return (await query(tables[table],partition(table),prefix))
      .filter(item => item.sourceTable === table).map(fieldsFromItem);
  }
  async function version() { return (await get(operations,CONTROL))?.revision ?? 0; }

  async function readSelection(route,body={},id) {
    const selected = route ? SELECTIONS[route] : Object.keys(tables);
    if (!selected) throw new TypeError('Missing collection selection');
    const revision = await version();
    const counter = await get(tables.settings,{PK:'COUNTERS#IMPORT',SK:'META'});
    if (!counter?.lastAssignedId) throw new Error('Synthetic fixture is missing');
    const rows = emptyRows();
    const state = { rows, counters:counter.lastAssignedId, revision, reversedSales:[] };
    await Promise.all(selected.map(async table => { rows[table] = await rowsFor(table); }));
    async function add(table,rowId) {
      const value = await row(table,rowId);
      if (value && !rows[table].some(existing=>existing.id===value.id)) rows[table].push(value);
    }
    if (PRODUCT_ROUTES.has(route)) await add('products',id);
    if (CUSTOMER_ROUTES.has(route)) await add('customers',id);
    if (CREDIT_ROUTES.has(route)) await add('credits',id);
    if (route === 'POST /inventory/movements') await add('products',body.product_id);
    if (route === 'DELETE /products/:id/permanent') rows.inventory_movements = await rowsFor('inventory_movements',`PRODUCT#${Number(id)}|`);
    if (route === 'POST /products' || route === 'PUT /products/:id') {
      const barcode = typeof body.barcode === 'string' && body.barcode.trim();
      if (barcode && barcode.length<=128) {
        const owner = await get(tables.products,{PK:`BARCODE#${barcode}`,SK:'OWNER'});
        await add('products',owner?.productId);
      }
    }
    if (CORRECTION_ROUTES.has(route) && typeof body.operation_id === 'string' && /^[\da-f-]{36}$/i.test(body.operation_id)) {
      const key = physicalKey(tables,operations,rowKey('cash_register_corrections',{operation_id:body.operation_id}));
      const item = await get(operations,key);
      if (item?.sourceTable === 'cash_register_corrections') rows.cash_register_corrections.push(fieldsFromItem(item));
    }
    if (CHECKOUT_ROUTES.has(route)) {
      const products = Array.isArray(body.items) && body.items.length<=30 ? body.items.map(item=>item?.product_id) : [];
      await Promise.all([...new Set(products.map(identifier))].map(product=>add('products',product)));
      await add('customers',body.customer_id);
      if (typeof body.idempotency_key === 'string' && /^[\w-]{1,128}$/.test(body.idempotency_key)) {
        const item = await get(operations,{PK:REQUESTS,SK:`IDEMPOTENCY#sales#${body.idempotency_key}`});
        if (item?.status === 'reversed') state.reversedSales.push(reverseMarker(item));
      }
    }
    if (route === 'DELETE /sales/:id') {
      rows.sale_items = await rowsFor('sale_items',`SALE#${Number(id)}|`);
      const owner = await get(operations,{PK:`SALE#${Number(id)}`, SK:'CREDIT'});
      await add('credits',owner?.creditId);
      await Promise.all([...new Set(rows.sale_items.map(line=>line.product_id))].map(product=>add('products',product)));
    }
    if (!route) {
      state.reversedSales = (await query(operations,REQUESTS)).filter(item=>item.status==='reversed').map(reverseMarker);
    }
    if (revision !== await version()) throw new StaleSnapshot();
    return state;
  }

  return { ...legacy, read:()=>readSelection(), readFor:readSelection };
}
