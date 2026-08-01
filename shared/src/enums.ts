// Shared types and constants used across client and server.
// String-literal unions (not TS enums) for frictionless cross-package use.

export type AccountType = 'transaction' | 'savings' | 'credit_card' | 'loan' | 'investment';

// Phase 1: manual | rule | ai. Phase 2 formalizes ai_auto + ai_suggested_accepted.
export type CategorySource = 'manual' | 'rule' | 'ai' | 'ai_auto' | 'ai_suggested_accepted';

export type InsightType = 'insight' | 'forecast' | 'anomaly';

export type ImportFileFormat = 'csv' | 'ofx' | 'qif';

export type RuleMatchType = 'contains' | 'regex' | 'equals' | 'amount_range';

// Phase 2 §3.3/§9.3 — origin of a rule.
export type RuleSource = 'manual' | 'ai_generated' | 'seeded';

// Phase 2 §7.3 — category kind.
export type CategoryType = 'income' | 'expense' | 'transfer';

export type AmountSignConvention = 'auto' | 'negIsExpense' | 'posIsExpense';

export const ACCOUNT_TYPES: AccountType[] = [
  'transaction',
  'savings',
  'credit_card',
  'loan',
  'investment',
];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  transaction: 'Transaction',
  savings: 'Savings',
  credit_card: 'Credit Card',
  loan: 'Loan',
  investment: 'Investment',
};

// Default category taxonomy (§3.3). Seed order defines default priority.
// Phase 2 §7.3: each default category carries a `type`.
export const DEFAULT_CATEGORIES: { name: string; type: CategoryType; subcategories?: string[] }[] = [
  { name: 'Groceries', type: 'expense' },
  { name: 'Dining & Takeaway', type: 'expense' },
  { name: 'Entertainment', type: 'expense' },
  { name: 'Health & Medical', type: 'expense' },
  { name: 'Education', type: 'expense' },
  { name: 'Utilities', type: 'expense' },
  { name: 'Transport', type: 'expense' },
  { name: 'Housing/Rent/Mortgage', type: 'expense' },
  { name: 'Insurance', type: 'expense' },
  { name: 'Shopping', type: 'expense' },
  { name: 'Travel', type: 'expense' },
  { name: 'Income', type: 'income' },
  { name: 'Transfers', type: 'transfer' },
  { name: 'Fees & Charges', type: 'expense' },
  { name: 'Subscriptions', type: 'expense' },
  { name: 'Other', type: 'expense' },
];

// Cloud-hosted Ollama model allow-list (§5.2). The /models listing may include
// names that only work against a local Ollama install; restrict the dropdown to
// these known cloud-hosted identifiers. Editable as the cloud catalogue grows.
export const OLLAMA_CLOUD_MODELS: string[] = [
  'llama3.1',
  'llama3.2',
  'llama3.3',
  'llama4',
  'qwen2.5',
  'qwen3',
  'deepseek-r1',
  'deepseek-v3',
  'gpt-oss',
  'mistral',
  'gemma3',
  'phi4',
];