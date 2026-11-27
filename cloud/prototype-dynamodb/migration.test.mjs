import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollectionStore } from './collection-store.mjs';
import { importSnapshot, prepareSnapshot, reconcileSnapshot } from './migration.mjs';
import { emptyRows } from './store.mjs';

function fixture() {
  const rows = emptyRows();
  rows.products.push(...Array.from({length:92},(_,index)=>({
    id:index+1,barcode:`SYN-${index+1}`,name:'Synthetic product',category_id:null,
    stock:1.25,min_stock:0,cost_price:10,margin_percent:10,sale_price:11,
  })));
  return { rows, sequences:Object.fromEntries(Object.keys(rows).map(table=>[table,table==='products'?150:null])) };
}

test('an interrupted import resumes its confirmed batches and preserves authoritative stock and sequence', async () => {
  const source=fixture();
  const contents=new Map();
  let writes=0;
  const keyOf=(table,item)=>JSON.stringify([table,item.PK.S,item.SK.S]);
  async function send(operation,args) {
    if (operation==='GetItem') return {Item:contents.get(keyOf(args.TableName,args.Key))};
    if (operation==='Query') return {Items:[...contents].filter(([key,value])=>
      JSON.parse(key)[0]===args.TableName && value.PK.S===args.ExpressionAttributeValues[':pk'].S
      && (!args.ExpressionAttributeValues[':prefix'] || value.SK.S.startsWith(args.ExpressionAttributeValues[':prefix'].S)),
    ).map(([,value])=>value)};
    assert.equal(operation,'TransactWriteItems');
    for(const {Put} of args.TransactItems) {
      const existing=contents.get(keyOf(Put.TableName,Put.Item));
      if(Put.ConditionExpression==='attribute_not_exists(PK)') assert.equal(existing,undefined);
      else {
        assert.equal(existing.status.S,'loading');
        assert.equal(existing.fingerprint.S,Put.ExpressionAttributeValues[':fingerprint'].S);
      }
    }
    writes++;
    for(const {Put} of args.TransactItems) contents.set(keyOf(Put.TableName,Put.Item),Put.Item);
  }
  await assert.rejects(importSnapshot(send,source,{afterBatch(){throw new Error('interrupted');}}),/interrupted/);
  await assert.rejects(createCollectionStore(send).read(),/Synthetic fixture is missing/);
  const changed=fixture();
  changed.rows.products[0].stock=77;
  await assert.rejects(importSnapshot(send,changed),/different import/);
  const resume=await importSnapshot(send,source);
  assert.equal(resume.skipped,1);
  assert.equal(resume.committed,2);
  const beforeRepeat=writes;
  assert.equal((await importSnapshot(send,source)).alreadyReady,true);
  assert.equal(writes,beforeRepeat);
  const stored=await createCollectionStore(send).read();
  assert.equal(stored.counters.products,150);
  assert.equal(stored.rows.products.find(product=>product.id===1).stock,1.25);
  const accepted=await reconcileSnapshot(send,source);
  assert.equal(accepted.matched,true);
  assert.equal(accepted.unexplainedCents,0);
});

test('source relationships and visible sequences are validated before import', () => {
  const source=fixture();
  source.rows.products[0].category_id=999;
  assert.throws(()=>prepareSnapshot(source),/Broken source reference products.category_id/);
  source.rows.products[0].category_id=null;
  source.sequences.products=null;
  assert.throws(()=>prepareSnapshot(source),/Invalid source sequence for products/);
});

test('a verified open cash reconciliation changes only its imported credit collection total', () => {
  const source = fixture();
  source.rows.cash_register_periods.push(
    { id: 1, status: 'closed', total_credit_sales: 125, total_credit_collected: 0 },
    { id: 2, status: 'open', total_credit_sales: 0, total_credit_collected: 0 },
  );
  source.rows.customers.push({ id: 1 });
  source.rows.sales.push({ id: 1, customer_id: 1, cash_register_id: 1, sale_type: 'credit', total: 60 });
  source.rows.credits.push({ id: 1, sale_id: 1, customer_id: 1 });
  source.rows.credit_payments.push({ id: 1, credit_id: 1, cash_register_id: 2, amount: 17.5 });
  Object.assign(source.sequences, { cash_register_periods: 2, customers: 1, sales: 1, credits: 1, credit_payments: 1 });
  source.cashCollectionAdjustments = [{ id: 2, storedCents: 0, ledgerCents: 1750 }];

  const { rows } = prepareSnapshot(source);
  assert.equal(rows.cash_register_periods[1].total_credit_collected, 17.5);
  assert.equal(source.rows.cash_register_periods[1].total_credit_collected, 0);
  assert.deepEqual(rows.cash_register_periods[0], source.rows.cash_register_periods[0]);
  assert.deepEqual(rows.credit_payments, source.rows.credit_payments);

  source.rows.credit_payments[0].amount = 18;
  assert.throws(() => prepareSnapshot(source), /no longer matches the source/);
  source.cashCollectionAdjustments[0].id = 1;
  assert.throws(() => prepareSnapshot(source), /no longer matches the source/);
});
