import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { getSqlite } from './index.js';

// Idempotent table creation directly from the schema (CREATE TABLE IF NOT EXISTS).
// This guarantees the app runs even without first running `drizzle-kit generate`.
// Drizzle migrations (./drizzle) are still preferred when present via migrate.ts.

const DDL = [
  `CREATE TABLE IF NOT EXISTS households (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6366f1',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    institution TEXT,
    type TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AUD',
    opening_balance REAL NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS account_ownership (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    percentage REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    is_custom INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    match_type TEXT NOT NULL,
    match_value TEXT NOT NULL,
    amount_min REAL,
    amount_max REAL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    file_name TEXT NOT NULL,
    file_format TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    description TEXT NOT NULL,
    raw_description TEXT,
    amount REAL NOT NULL,
    balance REAL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    import_batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL,
    is_transfer INTEGER NOT NULL DEFAULT 0,
    dedup_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS import_mappings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
    format TEXT NOT NULL,
    column_map TEXT NOT NULL,
    has_header INTEGER NOT NULL DEFAULT 1,
    date_format TEXT,
    amount_sign_convention TEXT NOT NULL DEFAULT 'auto'
  )`,
  `CREATE TABLE IF NOT EXISTS ai_insights (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    type TEXT NOT NULL,
    scope TEXT NOT NULL,
    content TEXT NOT NULL,
    related_period TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_dedup ON transactions(dedup_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_account ON account_ownership(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_member ON account_ownership(member_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_acc_member ON account_ownership(account_id, member_id)`,
];

export function bootstrap() {
  const sqlite = getSqlite();
  const dbUrl = process.env.DATABASE_URL || './data/homefinance.sqlite';
  fs.mkdirSync(path.dirname(path.resolve(dbUrl)), { recursive: true });
  const tx = sqlite.transaction(() => {
    for (const stmt of DDL) sqlite.exec(stmt);
  });
  tx();
}