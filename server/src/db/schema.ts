import { sqliteTable, text, real, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Timestamps stored as ISO strings (SQLite has no native datetime type we rely on).

// households: implicit single row for MVP (global). Kept for future multi-household.
export const households = sqliteTable('households', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  institution: text('institution'),
  type: text('type', { enum: ['transaction', 'savings', 'credit_card', 'loan', 'investment'] }).notNull(),
  currency: text('currency').notNull().default('AUD'),
  openingBalance: real('opening_balance').notNull().default(0),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  // Phase 2 §2 — credit card linking
  linkedRepaymentAccountId: text('linked_repayment_account_id'),
  creditLimit: real('credit_limit'),
  statementClosingDay: integer('statement_closing_day'),
  paymentDueDay: integer('payment_due_day'),
});

export const accountOwnership = sqliteTable('account_ownership', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => members.id, { onDelete: 'cascade' }),
  percentage: real('percentage').notNull(), // 0-100
});

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
  isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
  type: text('type', { enum: ['income', 'expense', 'transfer'] }), // Phase 2 §7.3
  essential: integer('essential', { mode: 'boolean' }), // true=need, false=want, null=untagged
});

// Per-category monthly spending budget (one row per category).
export const categoryBudgets = sqliteTable('category_budgets', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  monthlyAmount: real('monthly_amount').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rules = sqliteTable('rules', {
  id: text('id').primaryKey(),
  matchType: text('match_type', { enum: ['contains', 'regex', 'equals', 'amount_range'] }).notNull(),
  matchValue: text('match_value').notNull(),
  amountMin: real('amount_min'),
  amountMax: real('amount_max'),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(100),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ruleSource: text('rule_source', { enum: ['manual', 'ai_generated', 'seeded'] }).notNull().default('manual'),
  updatedFromAiAt: text('updated_from_ai_at'),
  seedVersion: text('seed_version'),
});

export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  importedAt: text('imported_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  fileName: text('file_name').notNull(),
  fileFormat: text('file_format', { enum: ['csv', 'ofx', 'qif'] }).notNull(),
  rowCount: integer('row_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  aiCategorizedCount: integer('ai_categorized_count').notNull().default(0), // Phase 2 §3.4
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // yyyy-mm-dd
  time: text('time'), // HH:mm:ss when the export carries a time, else null
  description: text('description').notNull(),
  rawDescription: text('raw_description'),
  amount: real('amount').notNull(), // negative = expense, positive = income
  balance: real('balance'),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  source: text('source', { enum: ['manual', 'rule', 'ai', 'ai_auto', 'ai_suggested_accepted'] }).notNull().default('manual'),
  importBatchId: text('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
  isTransfer: integer('is_transfer', { mode: 'boolean' }).notNull().default(false),
  linkedTransactionId: text('linked_transaction_id'), // Phase 2 §2.3
  needsReview: integer('needs_review', { mode: 'boolean' }).notNull().default(false), // Phase 2 §3.3
  // dedup hash: account_id + date + amount + description + optional time hash
  dedupHash: text('dedup_hash').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const importMappings = sqliteTable('import_mappings', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  format: text('format', { enum: ['csv', 'ofx', 'qif'] }).notNull(),
  columnMap: text('column_map').notNull(), // JSON
  hasHeader: integer('has_header', { mode: 'boolean' }).notNull().default(true),
  dateFormat: text('date_format'),
  amountSignConvention: text('amount_sign_convention', {
    enum: ['auto', 'negIsExpense', 'posIsExpense'],
  }).notNull().default('auto'),
});

export const aiInsights = sqliteTable('ai_insights', {
  id: text('id').primaryKey(),
  generatedAt: text('generated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  type: text('type', { enum: ['insight', 'forecast', 'anomaly'] }).notNull(),
  scope: text('scope').notNull(), // 'household' | member id | account id
  content: text('content').notNull(),
  relatedPeriod: text('related_period'),
});

// App settings (key/value store) — AI config etc.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Phase 2 §4 — Investments
export const investmentHoldings = sqliteTable('investment_holdings', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  purchaseDate: text('purchase_date').notNull(),
  quantity: real('quantity').notNull(),
  purchasePrice: real('purchase_price').notNull(),
  fees: real('fees'),
  importBatchId: text('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const priceSnapshots = sqliteTable('price_snapshots', {
  id: text('id').primaryKey(),
  ticker: text('ticker').notNull(),
  price: real('price').notNull(),
  currency: text('currency').notNull().default('AUD'),
  snapshotDate: text('snapshot_date').notNull(), // yyyy-mm-dd
  fetchedAt: text('fetched_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Phase 2 §3.3 — AI categorization audit log
export const aiCategorizationLog = sqliteTable('ai_categorization_log', {
  id: text('id').primaryKey(),
  transactionId: text('transaction_id'),
  batchId: text('batch_id'),
  description: text('description'),
  suggestedCategoryId: text('suggested_category_id'),
  applied: integer('applied', { mode: 'boolean' }).notNull().default(false),
  ruleCreatedOrUpdatedId: text('rule_created_or_updated_id'),
  note: text('note'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Phase 2 §5.3 — AI connection test history
export const aiConnectionTestLog = sqliteTable('ai_connection_test_log', {
  id: text('id').primaryKey(),
  testedAt: text('tested_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  outcome: text('outcome', { enum: ['success', 'failure'] }).notNull(),
  latencyMs: integer('latency_ms'),
  errorCategory: text('error_category'),
});

// Phase 2 §8.3 — cached forecast snapshots
export const forecastSnapshots = sqliteTable('forecast_snapshots', {
  id: text('id').primaryKey(),
  generatedAt: text('generated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  scope: text('scope').notNull(),
  horizonMonths: integer('horizon_months').notNull().default(12),
  payloadJson: text('payload_json').notNull(),
});

// Phase 2 §9.3 — seed-rule versioning tracking
export const seedRulesApplied = sqliteTable('seed_rules_applied', {
  seedVersion: text('seed_version').primaryKey(),
  appliedAt: text('applied_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  count: integer('count').notNull().default(0),
});