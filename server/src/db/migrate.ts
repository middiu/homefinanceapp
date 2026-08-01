import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, getSqlite } from './index.js';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

// Ensure data dir exists before opening DB.
const dbUrl = process.env.DATABASE_URL || './data/homefinance.sqlite';
fs.mkdirSync(path.dirname(path.resolve(dbUrl)), { recursive: true });

const sqlite = getSqlite();

// Apply Drizzle migrations if the migrations folder exists.
const migrationsFolder = path.resolve('./drizzle');
if (fs.existsSync(migrationsFolder)) {
  migrate(getDb(), { migrationsFolder });
  console.log('[db] migrations applied from', migrationsFolder);
} else {
  console.warn('[db] no migrations folder found; ensure schema is applied via bootstrap.');
}
console.log('[db] ready:', path.resolve(dbUrl));