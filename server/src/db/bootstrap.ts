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
    is_custom INTEGER NOT NULL DEFAULT 0,
    type TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS category_budgets (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    monthly_amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    time TEXT,
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
  // Phase 2 §4
  `CREATE TABLE IF NOT EXISTS investment_holdings (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    quantity REAL NOT NULL,
    purchase_price REAL NOT NULL,
    fees REAL,
    import_batch_id TEXT REFERENCES import_batches(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    price REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'AUD',
    snapshot_date TEXT NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 2 §3.3
  `CREATE TABLE IF NOT EXISTS ai_categorization_log (
    id TEXT PRIMARY KEY,
    transaction_id TEXT,
    batch_id TEXT,
    description TEXT,
    suggested_category_id TEXT,
    applied INTEGER NOT NULL DEFAULT 0,
    rule_created_or_updated_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Phase 2 §5.3
  `CREATE TABLE IF NOT EXISTS ai_connection_test_log (
    id TEXT PRIMARY KEY,
    tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome TEXT NOT NULL,
    latency_ms INTEGER,
    error_category TEXT
  )`,
  // Phase 2 §8.3
  `CREATE TABLE IF NOT EXISTS forecast_snapshots (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    scope TEXT NOT NULL,
    horizon_months INTEGER NOT NULL DEFAULT 12,
    payload_json TEXT NOT NULL
  )`,
  // Phase 2 §9.3
  `CREATE TABLE IF NOT EXISTS seed_rules_applied (
    seed_version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    count INTEGER NOT NULL DEFAULT 0
  )`,
];

// Indexes created AFTER migrations, so they can reference Phase 2 columns
// (e.g. needs_review) that are added to pre-existing tables via ALTER TABLE.
const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions(account_id, date)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_dedup ON transactions(dedup_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_needs_review ON transactions(needs_review)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(is_transfer)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_account ON account_ownership(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_member ON account_ownership(member_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_acc_member ON account_ownership(account_id, member_id)`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_account ON investment_holdings(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_holdings_ticker ON investment_holdings(ticker)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_price_snapshot_ticker_date ON price_snapshots(ticker, snapshot_date)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_catlog_batch ON ai_categorization_log(batch_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_category ON category_budgets(category_id)`,
];

// Columns added in Phase 2 to pre-existing Phase 1 tables. Each is applied only if the
// column is missing (PRAGMA table_info), so existing data is preserved across redeploy.
const MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  // accounts — credit card linking (§2)
  { table: 'accounts', column: 'linked_repayment_account_id', ddl: `ALTER TABLE accounts ADD COLUMN linked_repayment_account_id TEXT` },
  { table: 'accounts', column: 'credit_limit', ddl: `ALTER TABLE accounts ADD COLUMN credit_limit REAL` },
  { table: 'accounts', column: 'statement_closing_day', ddl: `ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER` },
  { table: 'accounts', column: 'payment_due_day', ddl: `ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER` },
  // categories — type (§7.3)
  { table: 'categories', column: 'type', ddl: `ALTER TABLE categories ADD COLUMN type TEXT` },
  // categories — essential flag (essential vs discretionary)
  { table: 'categories', column: 'essential', ddl: `ALTER TABLE categories ADD COLUMN essential INTEGER` },
  // rules — rule source / ai tracking / seed versioning (§3.3, §9.3)
  { table: 'rules', column: 'rule_source', ddl: `ALTER TABLE rules ADD COLUMN rule_source TEXT NOT NULL DEFAULT 'manual'` },
  { table: 'rules', column: 'updated_from_ai_at', ddl: `ALTER TABLE rules ADD COLUMN updated_from_ai_at TEXT` },
  { table: 'rules', column: 'seed_version', ddl: `ALTER TABLE rules ADD COLUMN seed_version TEXT` },
  // transactions — needs review + linked transfer (§2.3, §3.3)
  { table: 'transactions', column: 'linked_transaction_id', ddl: `ALTER TABLE transactions ADD COLUMN linked_transaction_id TEXT` },
  { table: 'transactions', column: 'needs_review', ddl: `ALTER TABLE transactions ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0` },
  // transactions — optional time for tighter dedup (same-day identicals)
  { table: 'transactions', column: 'time', ddl: `ALTER TABLE transactions ADD COLUMN time TEXT` },
  // import_batches — ai categorized count (§3.4)
  { table: 'import_batches', column: 'ai_categorized_count', ddl: `ALTER TABLE import_batches ADD COLUMN ai_categorized_count INTEGER NOT NULL DEFAULT 0` },
];

function existingColumns(table: string): Set<string> {
  const rows = getSqlite().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((r) => r.name));
}

export function bootstrap() {
  const sqlite = getSqlite();
  const dbUrl = process.env.DATABASE_URL || './data/homefinance.sqlite';
  fs.mkdirSync(path.dirname(path.resolve(dbUrl)), { recursive: true });
  const tx = sqlite.transaction(() => {
    for (const stmt of DDL) sqlite.exec(stmt);
    // Apply Phase 2 column migrations idempotently (preserves existing data).
    for (const m of MIGRATIONS) {
      try {
        const cols = existingColumns(m.table);
        if (!cols.has(m.column)) sqlite.exec(m.ddl);
      } catch (e) {
        // ADD COLUMN can fail if column exists; ignore safely.
        if (!String((e as Error).message).includes('duplicate column')) {
          // re-raise unexpected errors
          throw e;
        }
      }
    }
    // Indexes run last so they can reference migrated Phase 2 columns.
    for (const stmt of INDEX_DDL) sqlite.exec(stmt);
  });
  tx();
}