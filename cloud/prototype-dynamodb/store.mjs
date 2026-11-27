export const DATASET = 'michi-synthetic-full-2026-11-26';
export const TABLES = {
  categories: 'michi-poc-catalog',
  products: 'michi-poc-catalog',
  customers: 'michi-poc-customers',
  cash_register_periods: 'michi-poc-operations',
  cash_register_corrections: 'michi-poc-operations',
  sales: 'michi-poc-operations',
  sale_items: 'michi-poc-operations',
  credits: 'michi-poc-operations',
  credit_payments: 'michi-poc-operations',
  inventory_movements: 'michi-poc-operations',
  cash_movements: 'michi-poc-operations',
  settings: 'michi-poc-settings',
  data_versions: 'michi-poc-settings',
};
const ENTITY_TYPES = {
  categories: 'CATEGORY', products: 'PRODUCT', customers: 'CUSTOMER', cash_register_periods: 'CASH',
  cash_register_corrections: 'CASH_CORRECTION', sales: 'SALE', sale_items: 'SALE_ITEM', credits: 'CREDIT',
  credit_payments: 'CREDIT_PAYMENT', inventory_movements: 'INVENTORY_MOVEMENT', cash_movements: 'CASH_MOVEMENT',
  settings: 'SETTING', data_versions: 'DATA_VERSION',
};
const MONEY = new Set([
  'cost_price', 'sale_price', 'opening_cash', 'total_cash_sales', 'total_credit_sales', 'total_credit_collected',
  'total_expenses', 'closing_cash', 'subtotal', 'surcharge', 'total', 'cash_received', 'cash_change',
  'unit_price', 'line_total', 'original_amount', 'total_due', 'amount_paid', 'amount',
]);
const QUANTITY = new Set(['stock', 'min_stock', 'quantity']);
export const CONTROL = key('PROTOTYPE#FULL', 'VERSION');
const MAX_ITEMS = 100;
const POINT_READS = new Set(['products', 'customers', 'sales', 'credits']);

function key(pk, sk = 'META') {
  return { PK: pk, SK: sk };
}

function camel(field) {
  return field.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function snake(field) {
  return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function fieldsToItem(row) {
  return Object.fromEntries(Object.entries(row).map(([field, value]) => {
    if (MONEY.has(field)) return [`${camel(field)}Cents`, value === null ? null : Math.round(value * 100)];
    if (QUANTITY.has(field)) return [`${camel(field)}Milli`, Math.round(value * 1000)];
    if (field.endsWith('_percent')) {
      return [`${camel(field.slice(0, -8))}BasisPoints`, Math.round(value * 100)];
    }
    return [camel(field), value];
  }));
}

export function fieldsFromItem(item) {
  const { PK: _pk, SK: _sk, entityType: _entityType, sourceTable: _sourceTable, dataset: _dataset, ...fields } = item;
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => {
    if (name.endsWith('Cents')) return [snake(name.slice(0, -5)), value === null ? null : value / 100];
    if (name.endsWith('Milli')) return [snake(name.slice(0, -5)), value / 1000];
    if (name.endsWith('BasisPoints')) return [`${snake(name.slice(0, -11))}_percent`, value / 100];
    return [snake(name), value];
  }));
}

export function rowKey(table, row) {
  switch (table) {
    case 'cash_register_corrections': return key(`OPERATION#${row.operation_id}`, 'AUDIT');
    case 'sale_items': return key(`SALE#${row.sale_id}`, `ITEM#${row.id}`);
    case 'credit_payments': return key(`CREDIT#${row.credit_id}`, `PAYMENT#${row.created_at}#${row.id}`);
    case 'inventory_movements': return key(`PRODUCT#${row.product_id}`, `MOVEMENT#${row.created_at}#${row.id}`);
    case 'cash_movements': return key(`CASH#${row.cash_register_id}`, `MOVEMENT#${row.created_at}#${row.id}`);
    case 'settings': return key(`SETTING#${row.key}`, 'VALUE');
    case 'data_versions': return key(`VERSION#${row.module}`);
    default: return key(`${ENTITY_TYPES[table]}#${row.id}`);
  }
}

function entries({ rows, counters, reversedSales = [] }, tables, dataset) {
  const result = new Map();
  function add(table, identity, type, fields) {
    const item = { ...identity, dataset, entityType: type, ...fields };
    result.set(JSON.stringify([table, identity.PK, identity.SK]), { table, item });
  }
  for (const [sourceTable, table] of Object.entries(tables)) {
    for (const row of rows[sourceTable]) {
      add(table, rowKey(sourceTable, row), ENTITY_TYPES[sourceTable], { sourceTable, ...fieldsToItem(row) });
      if (['sales', 'cash_movements', 'credit_payments'].includes(sourceTable) && row.idempotency_key) {
        const reference = { entityId: row.id, sourceEntity: sourceTable };
        if (sourceTable === 'sales') reference.requestHash = row.request_hash ?? null;
        add(table, key(`IDEMPOTENCY#${sourceTable}#${row.idempotency_key}`, 'RESULT'), 'IDEMPOTENCY', reference);
      }
    }
  }
  for (const sale of reversedSales) {
    add(tables.sales, key(`IDEMPOTENCY#sales#${sale.idempotencyKey}`, 'RESULT'), 'IDEMPOTENCY', {
      sourceEntity: 'sales', status: 'reversed', ...sale,
    });
  }
  for (const row of rows.products) {
    add(tables.products, key(`BARCODE#${row.barcode}`, 'OWNER'), 'BARCODE', { productId: row.id });
  }
  for (const row of rows.categories) {
    if (row.parent_id !== null) {
      add(tables.categories, key(`CATEGORY#${row.parent_id}`, `CHILD#${row.id}`), 'CATEGORY_CHILD', { categoryId: row.id });
    }
  }
  for (const row of rows.credits) {
    add(tables.sales, key(`SALE#${row.sale_id}`, 'CREDIT'), 'SALE_CREDIT', { creditId: row.id });
  }
  const open = rows.cash_register_periods.find(row => row.status === 'open');
  if (open) add(tables.sales, key('STORE#1', 'OPEN_CASH'), 'OPEN_CASH', { cashId: open.id });
  add(tables.settings, key('COUNTERS#IMPORT'), 'COUNTER_STATE', { lastAssignedId: counters });
  return result;
}

function encode(value) {
  if (value === null) return { NULL: true };
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(encode) };
  if (value && typeof value === 'object') return { M: encodeItem(value) };
  throw new TypeError('Invalid item value');
}

export function encodeItem(item) {
  return Object.fromEntries(Object.entries(item).map(([name, value]) => [name, encode(value)]));
}

function decode(value) {
  if ('NULL' in value) return null;
  if ('S' in value) return value.S;
  if ('N' in value) {
    const number = Number(value.N);
    if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) throw new TypeError('Unsafe number');
    return number;
  }
  if ('BOOL' in value) return value.BOOL;
  if ('M' in value) return decodeItem(value.M);
  if ('L' in value) return value.L.map(decode);
  throw new TypeError('Unsupported attribute');
}

export function decodeItem(item) {
  return Object.fromEntries(Object.entries(item).map(([name, value]) => [name, decode(value)]));
}

export function emptyRows() {
  return Object.fromEntries(Object.keys(TABLES).map(table => [table, []]));
}

export function encodeSnapshot(state, { tables = TABLES, dataset = DATASET } = {}) {
  const items = [...entries(state, tables, dataset).values()].map(({ table, item }) => ({ table, item: encodeItem(item) }));
  items.push({ table: tables.sales, item: encodeItem({ ...CONTROL, dataset,
    entityType: 'PROTOTYPE_VERSION', revision: state.revision }) });
  return items;
}

export function createDynamoStore(send, { tables = TABLES, dataset = DATASET } = {}) {
  async function read(operation, input) {
    try {
      return await send(operation, input);
    } catch (error) {
      if (error.name !== 'TimeoutError') throw error;
      return send(operation, input);
    }
  }

  async function version() {
    const response = await read('GetItem', { TableName: tables.sales, Key: encodeItem(CONTROL), ConsistentRead: true });
    return response.Item?.dataset?.S === dataset ? decodeItem(response.Item).revision : 0;
  }

  async function readPages(operation, input) {
    const items = [];
    let startKey;
    do {
      const response = await read(operation, {
        ...input,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      });
      items.push(...(response.Items ?? []).map(decodeItem));
      startKey = response.LastEvaluatedKey;
    } while (startKey && Object.keys(startKey).length > 0);
    return items;
  }

  function scanTable(tableName) {
    return readPages('Scan', {
      TableName: tableName, ConsistentRead: true, Limit: 500,
      FilterExpression: 'dataset = :dataset', ExpressionAttributeValues: { ':dataset': { S: dataset } },
    });
  }

  async function getItem(tableName, identity) {
    const response = await read('GetItem', { TableName: tableName, Key: encodeItem(identity), ConsistentRead: true });
    const item = response.Item && decodeItem(response.Item);
    return item?.dataset === dataset ? item : undefined;
  }

  async function readByKey(selection, value) {
    const rows = emptyRows();
    const state = { rows, counters: {} };
    const id = Number(value);
    if (selection !== 'barcode' && selection !== 'currentCash' && (!Number.isSafeInteger(id) || id < 1)) return state;

    async function addRow(table, rowId) {
      if (rowId == null) return;
      const item = await getItem(tables[table], rowKey(table, { id: rowId }));
      if (item?.sourceTable === table) rows[table].push(fieldsFromItem(item));
    }

    async function addGroup(table, partition, prefix) {
      const items = await readPages('Query', {
        TableName: tables[table], ConsistentRead: true,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: encodeItem({ ':pk': partition, ':prefix': prefix }),
      });
      rows[table] = items.filter(item => item.dataset === dataset && item.sourceTable === table).map(fieldsFromItem);
    }

    if (POINT_READS.has(selection)) {
      await addRow(selection, id);
      return state;
    }

    // Related reads need the same revision so a concurrent mutation cannot mix two states.
    const first = await version();
    switch (selection) {
      case 'barcode': {
        const owner = await getItem(tables.products, key(`BARCODE#${value}`, 'OWNER'));
        if (owner?.entityType === 'BARCODE') await addRow('products', owner.productId);
        break;
      }
      case 'currentCash': {
        const pointer = await getItem(tables.sales, key('STORE#1', 'OPEN_CASH'));
        if (pointer?.entityType === 'OPEN_CASH') await addRow('cash_register_periods', pointer.cashId);
        break;
      }
      case 'saleDetail': {
        await addRow('sales', id);
        const sale = rows.sales[0];
        if (!sale) break;
        await Promise.all([addGroup('sale_items', `SALE#${id}`, 'ITEM#'), addRow('customers', sale.customer_id)]);
        const products = new Set(rows.sale_items.map(line => line.product_id));
        await Promise.all([...products].map(productId => addRow('products', productId)));
        break;
      }
      case 'inventoryMovements':
        await Promise.all([addGroup('inventory_movements', `PRODUCT#${id}`, 'MOVEMENT#'), addRow('products', id)]);
        break;
      case 'cashMovements':
        await addGroup('cash_movements', `CASH#${id}`, 'MOVEMENT#');
        break;
      case 'creditPayments':
        await addGroup('credit_payments', `CREDIT#${id}`, 'PAYMENT#');
        break;
      default: throw new TypeError('Unsupported keyed read');
    }
    if (first !== await version()) throw new StaleSnapshot();
    return state;
  }

  return {
    readByKey,
    async read() {
      // The same revision must cover every page across all four tables.
      const first = await version();
      const items = (await Promise.all([...new Set(Object.values(tables))].map(scanTable))).flat();
      if (first !== await version()) throw new StaleSnapshot();
      const rows = emptyRows();
      const reversedSales = [];
      const counters = items.find(item => item.entityType === 'COUNTER_STATE')?.lastAssignedId;
      if (!counters) throw new Error('Synthetic fixture is missing');
      for (const item of items) {
        if (item.sourceTable && Object.hasOwn(rows, item.sourceTable)) rows[item.sourceTable].push(fieldsFromItem(item));
        if (item.entityType === 'IDEMPOTENCY' && item.sourceEntity === 'sales' && item.status === 'reversed') {
          const { idempotencyKey, entityId, requestHash, reversedAt } = item;
          reversedSales.push({ idempotencyKey, entityId, requestHash, reversedAt });
        }
      }
      return { rows, counters, reversedSales, revision: first };
    },
    async commit(before, after) {
      const oldItems = entries(before, tables, dataset);
      const newItems = entries(after, tables, dataset);
      const changes = [];
      for (const [identity, { table, item }] of newItems) {
        const old = oldItems.get(identity);
        if (old && JSON.stringify(old.item) === JSON.stringify(item)) continue;
        changes.push({ Put: {
          TableName: table, Item: encodeItem(item),
          ...(old ? {} : { ConditionExpression: 'attribute_not_exists(PK)' }),
        } });
      }
      for (const [identity, { table, item }] of oldItems) {
        if (!newItems.has(identity)) changes.push({ Delete: { TableName: table, Key: encodeItem(key(item.PK, item.SK)) } });
      }
      if (changes.length === 0) return;
      if (changes.length >= MAX_ITEMS) throw new PrototypeLimit();
      changes.push({ Put: {
        TableName: tables.sales,
        Item: encodeItem({ ...CONTROL, dataset, entityType: 'PROTOTYPE_VERSION', revision: before.revision + 1 }),
        ConditionExpression: before.revision === 0 ? 'attribute_not_exists(PK)' : 'revision = :expected',
        ...(before.revision === 0 ? {} : { ExpressionAttributeValues: { ':expected': { N: String(before.revision) } } }),
      } });
      try {
        await send('TransactWriteItems', { TransactItems: changes });
      } catch (error) {
        if (error.name === 'TransactionCanceledException' && error.CancellationReasons?.some(reason => (
          ['ConditionalCheckFailed', 'TransactionConflict'].includes(reason.Code)
        ))) throw new StaleSnapshot();
        throw error;
      }
    },
  };
}

export class StaleSnapshot extends Error {}

export class PrototypeLimit extends Error {}
