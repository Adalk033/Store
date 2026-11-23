import assert from 'node:assert/strict';
import { beforeEach, afterEach, test } from 'node:test';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateCorrection, validateSale, validateTransfer } from '../electron/lib/cashValidation.ts';
import { expectedCashInPeriod } from '../src/lib/cashReconciliation.ts';

// Exercise the Lambda entry point and its transaction boundaries with an isolated SQL ledger.
// The adapter only translates PostgreSQL date syntax for the fixed UTC test timezone.
let db;
let failRefreshOf;
let tail = Promise.resolve();
let pool;
const stub = 'data:text/javascript,export default { Pool: class { constructor() { return globalThis.cashTestPool() } } }';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'pg' ? { url: stub, shortCircuit: true } : next(specifier, context);
  },
});
globalThis.cashTestPool = () => ({
  connect: () => pool.connect(),
  query: (...args) => pool.query(...args),
});
const { handler } = await import('../cloud/lambda-v1-handler.mjs');
hooks.deregister();
delete globalThis.cashTestPool;

function query(sql, values = []) {
  if (sql.startsWith('UPDATE cash_register_periods SET\n') && values[0] === failRefreshOf)
    throw new Error('Simulated second update failure');
  sql = sql.replaceAll('(created_at AT TIME ZONE $4)::date', 'date(created_at)')
    .replaceAll('(created_at AT TIME ZONE $5)::date', 'date(created_at)')
    .replaceAll('($4::date + (created_at AT TIME ZONE $5)::time) AT TIME ZONE $5', "datetime($4 || ' ' || time(created_at))")
    .replace(/\(\$(\d+)::timestamp AT TIME ZONE \$\d+\)/g, '$$$1')
    .replaceAll('NOW()', 'CURRENT_TIMESTAMP').replaceAll(' FOR UPDATE', '')
    .replace(/::(?:text|jsonb|date|numeric)/g, '');
  const bindings = [];
  sql = sql.replace(/\$(\d+)/g, (_, n) => { bindings.push(values[Number(n) - 1]); return '?'; });
  const stmt = db.prepare(sql);
  if (stmt.columns().length) {
    const rows = stmt.all(...bindings);
    return { rowCount: rows.length, rows };
  }
  return { rowCount: Number(stmt.run(...bindings).changes), rows: [] };
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SQL_FIXTURE);
  failRefreshOf = undefined;
  pool = {
    query,
    async connect() {
      let unlock;
      return {
        async query(sql, values) {
          // Each transaction needs its own connection in PostgreSQL. Delay BEGIN on the
          // single fixture connection until the production handler requests its ledger lock.
          if (sql === 'BEGIN') return;
          if (sql.includes('pg_advisory_xact_lock')) {
            const previous = tail;
            tail = new Promise(resolve => { unlock = resolve; });
            await previous;
            db.exec('BEGIN');
            return;
          }
          return query(sql, values);
        },
        release() { unlock?.(); },
      };
    },
  };
});
afterEach(() => db.close());

async function post(route, body) {
  const key = 'fixture-only';
  process.env.EXPECTED_API_KEY = key;
  const result = await handler({ rawPath: '/v1/' + route, requestContext: { http: { method: 'POST' } },
    headers: { 'x-api-key': key }, body: JSON.stringify(body) });
  return { status: result.statusCode, ...JSON.parse(result.body) };
}
const correct = (changes = {}) => ({ id: 1, version: 1, opening_cash: 10.25, closing_cash: 22.39,
  start_date: '2024-02-01', end_date: '2024-02-29', operation_id: randomUUID(), ...changes });
const transfer = (changes = {}) => ({ sale_id: 7, source_id: 1, target_id: 2, source_version: 1,
  target_version: 1, sale_date: '2024-03-01', operation_id: randomUUID(), ...changes });
const sale = (changes = {}) => ({ sale_type: 'cash', cash_register_id: 1, sale_date: '2024-02-29',
  items: [{ product_id: 15, quantity: 2, unit_price: 10.12 }], cash_received: 30, idempotency_key: randomUUID(), ...changes });
const row = (table, id) => db.prepare('SELECT * FROM ' + table + ' WHERE id=?').get(id);

test('IPC rejects malformed dates, identifiers, precision and nonfinite amounts', () => {
  for (const change of [{ opening_cash: null }, { closing_cash: Infinity }, { opening_cash: 0.009 },
    { start_date: '2023-02-29' }, { end_date: '2024-01-30' }, { version: 0 }])
    assert.throws(() => validateCorrection(correct(change)));
  for (const change of [{ target_id: 1 }, { target_version: -1 }, { sale_id: '7' }, { sale_date: 'tomorrow' }])
    assert.throws(() => validateTransfer(transfer(change)));
  assert.throws(() => validateSale(sale({ cash_register_id: '1' })));
  assert.throws(() => validateSale(sale({ items: [{ product_id: 15, quantity: Infinity, unit_price: 3 }] })));
  assert.doesNotThrow(() => validateSale(sale()));
});

test('inclusive boundaries accept leap day and reject touching another period, including an open period', async () => {
  for (const [end, expected] of [['2024-02-30',422], ['2024-03-01',409], ['2024-04-01',409], ['2024-01-31',422], ['2024-02-29',200]]) {
    const res = await post('cash-register/correct', correct({ end_date: end }));
    assert.equal(res.status, expected, res.error?.message);
  }
  assert.equal(row('cash_register_periods',1).closing_cash,22.39);
  assert.equal(row('cash_register_periods',1).status,'closed');
  assert.equal((await post('cash-register/open', { period_name: 'Overlap', opening_cash: 0, start_date:'2024-02-29' })).status,409);
});

test('period cannot strand a sale, payment or movement and cannot edit an open cut', async () => {
  for (const table of ['sales','credit_payments','cash_movements']) {
    db.prepare("UPDATE " + table + " SET created_at='2024-02-29 13:30:00' WHERE cash_register_id=1").run();
    assert.equal((await post('cash-register/correct',correct({ end_date:'2024-02-28' }))).status,409,table);
    db.prepare("UPDATE " + table + " SET created_at='2024-02-10' WHERE cash_register_id=1").run();
  }
  assert.equal((await post('cash-register/correct',correct({ id:3 }))).status,409);
});

test('reconciliation includes deposits and withdrawals and excludes unpaid credit from cash', async () => {
  assert.equal((await post('cash-register/correct',correct())).status,200);
  const result = await handler({ rawPath:'/v1/cash-register/periods', requestContext:{ http:{ method:'GET' } }, headers:{ 'x-api-key':'fixture-only' } });
  const p = JSON.parse(result.body).data.find(p => p.id === 1);
  assert.equal(p.total_cash_sales,12.34);
  assert.equal(p.total_credit_sales,30);
  assert.equal(p.total_credit_collected,5);
  assert.equal(expectedCashInPeriod(p), 10.25 + 12.34 + 5 + 3 - 2 - 1.2);
});

test('moving on credit preserves stock, payment, due date and original capture timestamp', async () => {
  const payment = row('credit_payments',1);
  const credit = row('credits',1);
  const stock = row('products',15);
  const request = transfer({ sale_id:8 });
  for (let i=0;i<2;i++) assert.equal((await post('cash-register/transfer',request)).status,200);
  assert.equal(row('sales',8).created_at,'2024-03-01 13:00:00');
  assert.equal(row('sales',8).captured_at,'2024-02-12');
  assert.deepEqual(payment,row('credit_payments',1));
  assert.deepEqual(credit,row('credits',1));
  assert.deepEqual(stock,row('products',15));
  assert.equal(row('cash_register_periods',1).total_credit_collected,5);
  assert.equal(row('cash_register_periods',1).total_credit_sales,0);
  assert.equal(row('cash_register_periods',2).total_credit_sales,30);
  assert.equal(db.prepare('SELECT count(*) n FROM cash_register_corrections').get().n,1);
  assert.equal((await post('cash-register/transfer',{...request,sale_id:7})).status,409);
});

test('failed second recalculation rolls back the sale, both totals and the audit entry', async t => {
  t.mock.method(console,'error',()=>{});
  const before = [row('sales',7),row('cash_register_periods',1),row('cash_register_periods',2)];
  failRefreshOf=2;
  assert.equal((await post('cash-register/transfer',transfer())).status,500);
  assert.deepEqual([row('sales',7),row('cash_register_periods',1),row('cash_register_periods',2)],before);
  assert.equal(db.prepare('SELECT count(*) n FROM cash_register_corrections').get().n,0);
});

test('competing transfers commit once and a stale correction cannot overwrite the result', async () => {
  const outcomes = await Promise.all([transfer(),transfer()].map(body => post('cash-register/transfer',body)));
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
  assert.equal(row('cash_register_periods',1).total_cash_sales,0);
  assert.equal(row('cash_register_periods',2).total_cash_sales,12.34);
  assert.equal((await post('cash-register/correct',correct())).status,409);
});

test('historical sale uses its business date, records capture separately and deducts stock once', async () => {
  const request=sale();
  const result=await post('cash-register/historical-sale',request);
  assert.equal(result.status,201,result.error?.message);
  const created = result.data.sale;
  assert.equal(created.total,20.24);
  assert.equal(created.cash_change,9.76);
  assert.equal(created.created_at,'2024-02-29 00:00:00');
  assert.notEqual(created.captured_at.slice(0,10),created.created_at.slice(0,10));
  assert.equal((await post('cash-register/historical-sale',request)).status,200);
  assert.equal((await post('cash-register/historical-sale',{...request, cash_received:100})).status,409);
  assert.equal(row('products',15).stock,8);
  assert.equal(row('cash_register_periods',1).total_cash_sales,32.58);
  assert.equal(row('cash_register_periods',1).status,'closed');
});

test('invalid destination date, stale price and insufficient cash leave the ledger intact',async () => {
  for (const [change,status] of [[{ sale_date:'2024-03-01' },409],[{ sale_date:'2099-03-01' },422],
    [{ sale_date:undefined },422],[{ cash_received:3 },422],[{ items:[{product_id:15,quantity:1,unit_price:1}] },409]]) {
    const result=await post('cash-register/historical-sale',sale(change));
    assert.equal(result.status,status,result.error?.message);
  }
  assert.equal((await post('cash-register/transfer',transfer({ sale_date:'2024-02-29' }))).status,409);
  assert.equal(row('products',15).stock,10);
  assert.equal(row('cash_register_periods',1).version,1);
});

test('historical credit records the down payment in the chosen cut, even without an open register', async () => {
  db.exec("DELETE FROM cash_register_periods WHERE status='open'");
  const request = sale({ sale_type: 'credit', customer_id: 5, credit_days: 2, initial_payment: 4.15 });
  const result = await post('cash-register/historical-sale', request);
  assert.equal(result.status, 201, result.error?.message);
  const credit = db.prepare('SELECT * FROM credits WHERE sale_id=?').get(result.data.sale.id);
  assert.equal(credit.due_date, '2024-03-02');
  assert.equal(credit.amount_paid, 4.15);
  // SQLite stores REAL while production stores NUMERIC(12,2). Compare monetary units in cents.
  assert.equal(Math.round(row('cash_register_periods', 1).total_credit_sales * 100), 5024);
  assert.equal(Math.round(row('cash_register_periods', 1).total_credit_collected * 100), 915);
  assert.equal(row('cash_register_periods', 1).total_cash_sales, 12.34);
});

test('opening after a closed cut accepts the following day but rejects its last day', async () => {
  db.exec("DELETE FROM cash_register_periods WHERE status='open'");
  const open = start_date => post('cash-register/open', { period_name: 'Abril', opening_cash: 0, start_date });
  assert.equal((await open('2024-03-31')).status, 409);
  assert.equal((await open('2024-04-01')).status, 201);
});

test('open period checkout and closing validate dates against recorded operations', async () => {
  const result = await post('sales', sale({ cash_register_id: undefined, sale_date: '2024-04-02' }));
  assert.equal(result.status, 201, result.error?.message);
  assert.equal(result.data.sale.cash_register_id, 3);
  const close = end_date => post('cash-register/close', { id: 3, closing_cash: 20.23, end_date });
  assert.equal((await close('2024-04-01')).status, 409);
  assert.equal((await close('2024-04-02')).status, 200);
  assert.equal(row('cash_register_periods', 3).total_cash_sales, 20.24);
  assert.equal(row('cash_register_periods', 3).closing_cash, 20.23);
});

test('correction retry preserves previous values and increments version only once', async () => {
  const request = correct();
  assert.equal((await post('cash-register/correct', request)).status, 200);
  assert.equal((await post('cash-register/correct', request)).status, 200);
  assert.equal(row('cash_register_periods', 1).version, 2);
  const audit = db.prepare('SELECT previous_values, request FROM cash_register_corrections').get();
  assert.equal(JSON.parse(audit.previous_values).opening_cash, 0);
  assert.equal(JSON.parse(audit.request).opening_cash, 10.25);
});

const SQL_FIXTURE = `
CREATE TABLE cash_register_periods(id INTEGER PRIMARY KEY,period_name TEXT,start_date TEXT,end_date TEXT,status TEXT,
  version INTEGER DEFAULT 1,opening_cash REAL DEFAULT 0,closing_cash REAL,total_cash_sales REAL DEFAULT 0,
  total_credit_sales REAL DEFAULT 0,total_credit_collected REAL DEFAULT 0,total_expenses REAL DEFAULT 0,created_at TEXT);
INSERT INTO cash_register_periods(id,start_date,end_date,status) VALUES
 (1,'2024-02-01','2024-02-29','closed'),(2,'2024-03-01','2024-03-31','closed'),(3,'2024-04-01',NULL,'open');
CREATE TABLE sales(id INTEGER PRIMARY KEY,sale_type TEXT,customer_id INTEGER,subtotal REAL,surcharge REAL,total REAL,
  cash_received REAL,cash_change REAL,cash_register_id INTEGER,idempotency_key TEXT UNIQUE,request_hash TEXT,created_at TEXT,captured_at TEXT DEFAULT CURRENT_TIMESTAMP);
INSERT INTO sales(id,sale_type,total,cash_register_id,created_at,captured_at) VALUES
 (7,'cash',12.34,1,'2024-02-10 12:00:00','2024-02-12'),(8,'credit',30,1,'2024-02-10 13:00:00','2024-02-12');
CREATE TABLE settings(key TEXT,value TEXT);
INSERT INTO settings VALUES('business_timezone','UTC');
CREATE TABLE cash_movements(id INTEGER PRIMARY KEY,cash_register_id INTEGER,type TEXT,amount REAL,created_at TEXT);
INSERT INTO cash_movements VALUES(1,1,'deposit',3,'2024-02-10'),(2,1,'withdrawal',1.2,'2024-02-10'),(3,1,'expense',2,'2024-02-10');
CREATE TABLE credits(id INTEGER PRIMARY KEY,sale_id INTEGER,due_date TEXT, customer_id INTEGER,
 original_amount REAL,surcharge_percent REAL,surcharge_applied INTEGER,total_due REAL,amount_paid REAL,status TEXT,paid_at TEXT,created_at TEXT);
INSERT INTO credits(id,sale_id,due_date) VALUES(1,8,'2024-02-17');
CREATE TABLE credit_payments(id INTEGER PRIMARY KEY,credit_id INTEGER,cash_register_id INTEGER,amount REAL,created_at TEXT);
INSERT INTO credit_payments VALUES(1,1,1,5,'2024-02-11');
CREATE TABLE cash_register_corrections(operation_id TEXT PRIMARY KEY,action TEXT,request TEXT,previous_values TEXT);
CREATE TABLE products(id INTEGER PRIMARY KEY,stock REAL,sale_price REAL,is_active INTEGER);
INSERT INTO products VALUES(15,10,10.12,1);
CREATE TABLE sale_items(sale_id INTEGER,product_id INTEGER,quantity REAL,unit_price REAL);
CREATE TABLE inventory_movements(product_id INTEGER,type TEXT,quantity REAL,reference_id INTEGER,notes TEXT,created_at TEXT);
`;
