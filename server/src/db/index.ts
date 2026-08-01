import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'node:path';
import fs from 'node:fs';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;
  const dbUrl = process.env.DATABASE_URL || './data/homefinance.sqlite';
  const resolved = path.resolve(dbUrl);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const sqlite = new Database(resolved);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  _sqlite = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function getSqlite() {
  if (!_sqlite) getDb();
  return _sqlite!;
}

export { schema };