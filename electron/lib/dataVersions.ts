import { getDatabase } from '../database/connection';
import type { DataVersionMap } from '../../src/types/database';

/**
 * All tracked modules for data versioning.
 * When a mutation occurs in a module, its version is incremented.
 */
const VERSIONED_MODULES = [
  'cash',
  'sales',
  'inventory',
  'credits',
  'customers',
  'products',
] as const;

export type VersionedModule = (typeof VERSIONED_MODULES)[number];

/**
 * Initialize the data_versions table rows for all modules.
 * Called once during migration; uses INSERT OR IGNORE so it is idempotent.
 */
export function initDataVersions(): void {
  const db = getDatabase();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO data_versions (module, version) VALUES (?, 0)'
  );
  const transaction = db.transaction(() => {
    for (const mod of VERSIONED_MODULES) {
      insert.run(mod);
    }
  });
  transaction();
}

/**
 * Increment the version counter for a module.
 * Call this after every successful mutation (insert/update/delete) in the module.
 */
export function incrementVersion(module: VersionedModule): void {
  const db = getDatabase();
  db.prepare(
    "UPDATE data_versions SET version = version + 1, updated_at = datetime('now','localtime') WHERE module = ?"
  ).run(module);
}

/**
 * Get all current data versions as a map.
 * Renderer polls this to detect changes without fetching full datasets.
 */
export function getAllVersions(): DataVersionMap {
  const db = getDatabase();
  const rows = db.prepare('SELECT module, version FROM data_versions').all() as Array<{
    module: string;
    version: number;
  }>;

  const result: DataVersionMap = {};
  for (const row of rows) {
    result[row.module] = row.version;
  }
  return result;
}

/**
 * Get the version for a specific module.
 */
export function getVersion(module: VersionedModule): number {
  const db = getDatabase();
  const row = db.prepare('SELECT version FROM data_versions WHERE module = ?').get(module) as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}
