import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { CONTROL, PrototypeLimit, decodeItem, encodeItem } from './store.mjs';

export const RECOVERY_PARTITION = 'RECOVERY#WRITES';
const MAX_PAYLOAD = 300 * 1024;
const MAX_DECOMPRESSED = 8 * 1024 * 1024;

function digest(payload) {
  return createHash('sha256').update(payload).digest('hex');
}

function revisionToken(revision) {
  return `REVISION#${String(revision).padStart(16, '0')}`;
}

function transactionRevision(changes, operations, dataset) {
  const marker = changes.at(-1)?.Put;
  const revision = Number(marker?.Item?.revision?.N);
  if (marker?.TableName !== operations || marker?.Item?.PK?.S !== CONTROL.PK || marker?.Item?.SK?.S !== CONTROL.SK
      || marker?.Item?.dataset?.S !== dataset || !Number.isSafeInteger(revision) || revision < 2
      || marker?.ExpressionAttributeValues?.[':expected']?.N !== String(revision - 1)) {
    throw new Error('Missing recovery transaction revision');
  }
  return revision;
}

export function recoveryEntry(operations, dataset, changes) {
  const revision = transactionRevision(changes, operations, dataset);
  const json = Buffer.from(JSON.stringify(changes));
  if (json.length > MAX_DECOMPRESSED) throw new PrototypeLimit();
  const compressed = deflateRawSync(json);
  const payload = compressed.toString('base64');
  if (payload.length > MAX_PAYLOAD) throw new PrototypeLimit();
  return { Put: {
    TableName: operations,
    Item: encodeItem({ PK: RECOVERY_PARTITION, SK: revisionToken(revision), dataset,
      entityType: 'RECOVERY_TRANSACTION', revision, payload, sha256: digest(compressed) }),
    ConditionExpression: 'attribute_not_exists(PK)',
  } };
}

export async function replayRecoveryJournal(send, items, { sourceTables, targetTables, dataset, startRevision, endRevision }) {
  const destination = new Map(Object.entries(sourceTables).map(([name, table]) => [table, targetTables[name]]));
  const targets = [...destination.values()];
  if (!Number.isSafeInteger(startRevision) || !Number.isSafeInteger(endRevision) || startRevision < 1
      || endRevision < startRevision || items.length !== endRevision - startRevision
      || targets.some(target => !target || destination.has(target)) || new Set(targets).size !== targets.length
      || Object.entries(sourceTables).some(([name, table]) => destination.get(table) !== targetTables[name])) {
    throw new Error('Recovery requires a complete journal and isolated target tables');
  }

  const transactions = items.map((raw, index) => {
    const item = decodeItem(raw);
    const revision = startRevision + index + 1;
    if (item.PK !== RECOVERY_PARTITION || item.SK !== revisionToken(revision) || item.revision !== revision
        || item.dataset !== dataset || item.entityType !== 'RECOVERY_TRANSACTION' || typeof item.payload !== 'string'
        || item.payload.length > MAX_PAYLOAD) throw new Error('Invalid recovery journal entry');
    const compressed = Buffer.from(item.payload, 'base64');
    if (digest(compressed) !== item.sha256) throw new Error('Recovery journal checksum mismatch');
    const changes = JSON.parse(inflateRawSync(compressed, { maxOutputLength: MAX_DECOMPRESSED }));
    if (!Array.isArray(changes) || !changes.length || changes.length >= 100
        || transactionRevision(changes, sourceTables.sales, dataset) !== revision) {
      throw new Error('Invalid recovery transaction');
    }
    const remapped = changes.map(change => {
      const kind = change.Put ? 'Put' : 'Delete';
      const operation = change[kind];
      const TableName = destination.get(operation?.TableName);
      const key = operation?.Item ?? operation?.Key;
      if (!TableName || Object.keys(change).length !== 1 || typeof key?.PK?.S !== 'string'
          || key.PK.S === RECOVERY_PARTITION || typeof key?.SK?.S !== 'string'
          || (kind === 'Put' && key.dataset?.S !== dataset)) throw new Error('Invalid recovery transaction item');
      return { [kind]: { ...operation, TableName } };
    });
    return [...remapped, recoveryEntry(targetTables.sales, dataset, remapped)];
  });

  const read = await send('GetItem', { TableName: targetTables.sales, Key: encodeItem(CONTROL), ConsistentRead: true });
  if (read.Item?.dataset?.S !== dataset || Number(read.Item.revision?.N) !== startRevision) {
    throw new Error('Recovery target does not match the verified starting revision');
  }
  for (const changes of transactions) await send('TransactWriteItems', { TransactItems: changes });
  return endRevision;
}
