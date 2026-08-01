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
});

export const importBatches = sqliteTable('import_batches', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  importedAt: text('imported_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  fileName: text('file_name').notNull(),
  fileFormat: text('file_format', { enum: ['csv', 'ofx', 'qif'] }).notNull(),
  rowCount: integer('row_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
});

export const transactions = sqliteTable('transactions', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // yyyy-mm-dd
  description: text('description').notNull(),
  rawDescription: text('raw_description'),
  amount: real('amount').notNull(), // negative = expense, positive = income
  balance: real('balance'),
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  source: text('source', { enum: ['manual', 'rule', 'ai'] }).notNull().default('manual'),
  importBatchId: text('import_batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
  isTransfer: integer('is_transfer', { mode: 'boolean' }).notNull().default(false),
  // dedup hash: account_id + date + amount + description hash
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