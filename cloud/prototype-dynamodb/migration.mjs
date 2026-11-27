import { createHash } from 'node:crypto';
import { createCollectionStore, encodeCollectionSnapshot } from './collection-store.mjs';
import { cashSummary, context } from './domain.mjs';
import { CONTROL, DATASET, TABLES, decodeItem, encodeItem } from './store.mjs';

const IMPORT = 'IMPORT#AURORA';
export const MANIFEST_KEY = Object.freeze({ PK: IMPORT, SK: 'MANIFEST' });
const RECORD_KEYS = { settings:'key', data_versions:'module', cash_register_corrections:'operation_id' };
const LINKS = [
  ['categories','parent_id','categories',true], ['products','category_id','categories',true],
  ['sales','customer_id','customers',true], ['sales','cash_register_id','cash_register_periods',true],
  ['sale_items','sale_id','sales',false], ['sale_items','product_id','products',false],
  ['credits','sale_id','sales',false], ['credits','customer_id','customers',false],
  ['credit_payments','credit_id','credits',false], ['credit_payments','cash_register_id','cash_register_periods',true],
  ['inventory_movements','product_id','products',false], ['cash_movements','cash_register_id','cash_register_periods',false],
];
const BATCH_SIZE = 90;

function insist(condition, reason) {
  if (!condition) throw new Error(reason);
}

function canonical(data) {
  if (Array.isArray(data)) return data.map(canonical);
  if (data && typeof data === 'object') return Object.fromEntries(
    Object.keys(data).sort().map(key => [key, canonical(data[key])]),
  );
  return data;
}

function hash(data) {
  return createHash('sha256').update(JSON.stringify(canonical(data))).digest('hex');
}

function reconcileOpenCashCollections(rows, adjustments) {
  insist(Array.isArray(adjustments), 'Invalid cash reconciliation list');
  const reviewed = new Set();
  for (const { id, storedCents, ledgerCents } of adjustments) {
    insist(Number.isSafeInteger(id) && !reviewed.has(id) && Number.isSafeInteger(storedCents)
      && Number.isSafeInteger(ledgerCents) && storedCents !== ledgerCents,
    'Invalid cash reconciliation evidence');
    reviewed.add(id);
    const period = rows.cash_register_periods.find(register => register.id === id);
    insist(period?.status === 'open'
      && Math.round(period.total_credit_collected * 100) === storedCents
      && Math.round(cashSummary(rows, id).total_credit_collected * 100) === ledgerCents,
    'Cash reconciliation evidence no longer matches the source');
    period.total_credit_collected = ledgerCents / 100;
  }
}

export function prepareSnapshot({ rows: input, sequences, cashCollectionAdjustments = [] }) {
  const names = Object.keys(TABLES);
  insist(input && Object.keys(input).length === names.length && names.every(name => Array.isArray(input[name])),
    'The snapshot must contain all 13 source tables');
  insist(sequences && typeof sequences === 'object', 'The snapshot needs source sequence values');
  const rows = {};
  const keys = {};
  const counters = {};
  for (const table of names) {
    const key = RECORD_KEYS[table] ?? 'id';
    keys[table] = new Set();
    rows[table] = input[table].map(row => {
      insist(row && typeof row === 'object' && !Array.isArray(row), `Invalid source row in ${table}`);
      const value = row[key];
      insist(key === 'id' ? Number.isSafeInteger(value) && value > 0 : typeof value === 'string' && value.length > 0,
        `Invalid primary key in ${table}`);
      insist(!keys[table].has(value), `Duplicate primary key in ${table}`);
      keys[table].add(value);
      return canonical(row);
    }).sort((a,b) => key === 'id' ? a.id-b.id : a[key].localeCompare(b[key],'en'));
    if (key !== 'id') continue;
    const maxId = rows[table].at(-1)?.id ?? 0;
    const last = sequences[table];
    insist(Number.isSafeInteger(last) && last >= 0 || maxId === 0 && last === null,
      `Invalid source sequence for ${table}`);
    counters[table] = Math.max(maxId, last ?? 0);
  }
  for (const [table, field, target, nullable] of LINKS) {
    insist(rows[table].every(row => nullable && row[field] === null || keys[target].has(row[field])),
      `Broken source reference ${table}.${field}`);
  }
  insist(new Set(rows.products.map(row=>row.barcode)).size === rows.products.length, 'Duplicate product barcode');
  insist(new Set(rows.credits.map(row=>row.sale_id)).size === rows.credits.length, 'Duplicate credit for a sale');
  insist(rows.cash_register_periods.filter(row=>row.status==='open').length <= 1, 'More than one open cash register');
  for (const table of ['sales','credit_payments','cash_movements']) {
    const ids=rows[table].map(row=>row.idempotency_key).filter(value=>value!=null);
    insist(new Set(ids).size===ids.length,`Duplicate idempotency key in ${table}`);
  }
  const categories = new Map(rows.categories.map(row=>[row.id,row.parent_id]));
  for (const category of rows.categories) {
    const chain = new Set([category.id]);
    for (let parent=category.parent_id; parent!==null; parent=categories.get(parent)) {
      insist(!chain.has(parent), 'Category hierarchy contains a cycle');
      chain.add(parent);
    }
  }
  reconcileOpenCashCollections(rows, cashCollectionAdjustments);
  return { rows, counters, revision:1, reversedSales:[] };
}

async function readMarker(send, key, { tables, dataset }) {
  const response = await send('GetItem',{ TableName:tables.settings,Key:encodeItem(key),ConsistentRead:true });
  if (!response.Item) return;
  insist(response.Item.dataset?.S===dataset, 'Import marker belongs to another dataset');
  return decodeItem(response.Item);
}

function newItem(table, item) {
  return { Put: { TableName:table, Item:item, ConditionExpression:'attribute_not_exists(PK)' } };
}

async function commitVerified(send, changes, key, expected, storage) {
  try { await send('TransactWriteItems',{TransactItems:changes}); }
  catch (error) {
    const stored = await readMarker(send,key,storage);
    if (!stored || Object.entries(expected).some(([field,value])=>stored[field]!==value)) throw error;
  }
}

export async function importSnapshot(send, source, { afterBatch, tables = TABLES, dataset = DATASET } = {}) {
  const storage = { tables, dataset };
  const state = prepareSnapshot(source);
  const cashCollectionAdjustments = source.cashCollectionAdjustments ?? [];
  const reconciliations = cashCollectionAdjustments.length ? { cashCollectionAdjustments } : {};
  const fingerprint = hash({layout:'collections',rows:state.rows,counters:state.counters,...reconciliations});
  const manifestData = { ...MANIFEST_KEY, dataset, entityType:'IMPORT_MANIFEST', fingerprint,
    layout:'collections', sourceExportedAt:source.exportedAt ?? null, sourceEngineVersion:source.sourceEngineVersion ?? null,
    counts:Object.fromEntries(Object.entries(state.rows).map(([table,rows])=>[table,rows.length])),
    ...reconciliations,
  };
  let manifest = await readMarker(send,MANIFEST_KEY,storage);
  insist(!manifest || manifest.fingerprint===fingerprint, 'This destination contains a different import');
  if (manifest?.status === 'ready') return { fingerprint, committed:0, alreadyReady:true };
  if (!manifest) {
    const item=encodeItem({...manifestData,status:'loading'});
    await commitVerified(send,[newItem(tables.settings,item)],MANIFEST_KEY,{fingerprint,status:'loading'},storage);
    manifest = await readMarker(send,MANIFEST_KEY,storage);
    insist(manifest?.fingerprint===fingerprint, 'The import manifest could not be confirmed');
    if (manifest.status === 'ready') return { fingerprint, committed:0, alreadyReady:true };
  }
  insist(manifest.status==='loading', 'Unexpected import state');
  const staged = [];
  const publish = [];
  for (const entry of encodeCollectionSnapshot(state,storage)) {
    const { table, item } = entry;
    if (table===tables.sales && item.PK.S===CONTROL.PK || table===tables.settings && item.PK.S==='COUNTERS#IMPORT') {
      publish.push(newItem(table,item));
    } else staged.push(entry);
  }
  let committed = 0;
  let skipped = 0;
  for (let offset=0; offset<staged.length; offset+=BATCH_SIZE) {
    const articles=staged.slice(offset,offset+BATCH_SIZE);
    const key={PK:IMPORT,SK:`BATCH#${offset/BATCH_SIZE}`};
    const digest=hash(articles);
    const marker=await readMarker(send,key,storage);
    if (marker) {
      insist(marker.fingerprint===fingerprint && marker.digest===digest,'Import checkpoint differs from source');
      skipped += 1;
      continue;
    }
    const checkpoint=encodeItem({...key,dataset,entityType:'IMPORT_CHECKPOINT',fingerprint,digest});
    const writes=articles.map(({table,item})=>newItem(table,item));
    await commitVerified(send,[...writes,newItem(tables.settings,checkpoint)],key,{fingerprint,digest},storage);
    committed += 1;
    await afterBatch?.(committed);
  }
  const ready=encodeItem({...manifestData,status:'ready'});
  await commitVerified(send,[...publish,{Put:{TableName:tables.settings,Item:ready,
    ConditionExpression:'fingerprint = :fingerprint AND #status = :loading',
    ExpressionAttributeNames:{'#status':'status'},
    ExpressionAttributeValues:encodeItem({':fingerprint':fingerprint,':loading':'loading'}),
  }}],MANIFEST_KEY,{fingerprint,status:'ready'},storage);
  return { fingerprint, committed, skipped, alreadyReady:false };
}

export async function reconcileSnapshot(send, source, storage) {
  const expected=prepareSnapshot(source);
  const actual=await createCollectionStore(send,storage).read();
  const mismatches = [];
  const tables = {};
  for (const [table, rows] of Object.entries(expected.rows)) {
    const sortKey=RECORD_KEYS[table] ?? 'id';
    const sort=(a,b)=>sortKey==='id'?a.id-b.id:a[sortKey].localeCompare(b[sortKey],'en');
    tables[table]={source:rows.length,destination:actual.rows[table].length};
    if (hash(rows)!==hash(actual.rows[table].toSorted(sort))) mismatches.push(table);
  }
  if (hash(expected.counters)!==hash(actual.counters)) mismatches.push('identity_sequences');
  const money = ['total_cash_sales','total_credit_sales','total_credit_collected','total_expenses',
    'total_deposits','total_withdrawals'];
  const sourceCash = new Map(source.cash?.map(period=>[period.id,period]) ?? []);
  let unexplainedCents = 0;
  const inheritedCash = [];
  for (const period of expected.rows.cash_register_periods) {
    const correct=sourceCash.get(period.id) ?? cashSummary(expected.rows,period.id);
    const copied=cashSummary(actual.rows,period.id);
    for (const field of money) unexplainedCents+=Math.abs(Math.round(correct[field]*100)-Math.round(copied[field]*100));
    for (const field of money.slice(0,4)) {
      const difference=Math.round(period[field]*100)-Math.round(correct[field]*100);
      if (difference) inheritedCash.push({id:period.id,field,differenceCents:difference});
    }
  }
  if (source.daily) {
    const { businessDay }=context(actual,{},'2026-01-01T00:00:00.000Z');
    const daily=new Map();
    for (const sale of actual.rows.sales) {
      const day=businessDay(sale.created_at);
      const report=daily.get(day) ?? {count:0,cash:0,credit:0};
      report.count+=1;
      report[sale.sale_type]+=Math.round(sale.total*100);
      daily.set(day,report);
    }
    let dayMismatch=daily.size!==source.daily.length;
    for (const report of source.daily) {
      const copied=daily.get(report.date) ?? {count:0,cash:0,credit:0};
      if (copied.count!==report.count) dayMismatch=true;
      unexplainedCents+=Math.abs(copied.cash-Math.round(report.total_cash*100))+
        Math.abs(copied.credit-Math.round(report.total_credit*100));
    }
    if (dayMismatch) mismatches.push('daily_sales');
  }
  return { tables, mismatches, unexplainedCents, inheritedCash, matched:mismatches.length===0 && unexplainedCents===0 };
}
