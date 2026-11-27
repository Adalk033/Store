import { createCollectionStore } from './collection-store.mjs';
import { createHandler } from './handler.mjs';
import { MANIFEST_KEY } from './migration.mjs';
import { TABLES, encodeItem } from './store.mjs';

const REGION = 'mx-central-1';
export const PRODUCTION_STORAGE = Object.freeze({
  tables: Object.freeze(Object.fromEntries(Object.entries(TABLES).map(([entity, table]) => [
    entity, table.replace(/^michi-poc-/, 'michi-prod-'),
  ]))),
  dataset: 'michi-production',
});

export function createProductionHandler(send, { apiId, apiKeys, writesEnabled = false, now }) {
  if (!/^[a-z0-9]{10}$/.test(apiId ?? '') || !Array.isArray(apiKeys) || apiKeys.length === 0
      || apiKeys.some(key => typeof key !== 'string' || key.length < 20 || key.length > 256)) {
    throw new TypeError('Invalid production API configuration');
  }
  const store = createCollectionStore(send, { ...PRODUCTION_STORAGE, recordWrites: true });
  return createHandler({ store, stage: 'prod', apiId, apiKey: apiKeys, writesEnabled: writesEnabled === true, now,
    async verifyReady() {
      const { Item } = await send('GetItem', { TableName: PRODUCTION_STORAGE.tables.settings,
        Key: encodeItem(MANIFEST_KEY), ConsistentRead: true });
      return Item?.dataset?.S === PRODUCTION_STORAGE.dataset && Item.status?.S === 'ready';
    },
  });
}

let production;
export async function handler(event) {
  if (!production) {
    const apiId = process.env.MICHI_POS_API_ID;
    const apiKeys = [process.env.EXPECTED_API_KEYS, process.env.EXPECTED_API_KEY]
      .flatMap(value => value?.split(',') ?? []).map(value => value.trim()).filter(Boolean);
    if (process.env.APP_ENV !== 'prod' || process.env.AWS_REGION !== REGION || !apiKeys.length
        || !/^[a-z0-9]{10}$/.test(apiId ?? '') || apiKeys.some(key => key.length < 20 || key.length > 256)) {
      return { statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify({ ok: false, error: { code: 'invalid_environment', message: 'El POS está en mantenimiento' } }) };
    }
    const sdk = await import('@aws-sdk/client-dynamodb');
    const client = new sdk.DynamoDBClient({ region: REGION, maxAttempts: 1 });
    const commands = { GetItem: sdk.GetItemCommand, Query: sdk.QueryCommand, TransactWriteItems: sdk.TransactWriteItemsCommand };
    production = createProductionHandler((operation, input) => client.send(new commands[operation](input)), {
      apiId, apiKeys, writesEnabled: process.env.MICHI_DYNAMO_WRITES_ENABLED === 'true',
    });
  }
  return production(event);
}
