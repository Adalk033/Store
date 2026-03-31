import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  // In dev use project root; in production use the OS userData folder
  const dbDir = app.isPackaged ? app.getPath('userData') : app.getAppPath();
  const dbPath = path.join(dbDir, 'store-internal.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
