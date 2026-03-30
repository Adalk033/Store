import { getDatabase } from '../connection';
import type { Setting } from '../../../src/types/database';

export function getSetting(key: string): string | undefined {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Setting | undefined;
  return row?.value;
}

export function getAllSettings(): Setting[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM settings ORDER BY key').all() as Setting[];
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
