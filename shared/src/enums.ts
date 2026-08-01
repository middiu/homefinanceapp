// Shared types and constants used across client and server.
// String-literal unions (not TS enums) for frictionless cross-package use.

export type AccountType = 'transaction' | 'savings' | 'credit_card' | 'loan' | 'investment';

export type CategorySource = 'manual' | 'rule' | 'ai';

export type InsightType = 'insight' | 'forecast' | 'anomaly';

export type ImportFileFormat = 'csv' | 'ofx' | 'qif';

export type RuleMatchType = 'contains' | 'regex' | 'equals' | 'amount_range';

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
export const DEFAULT_CATEGORIES: { name: string; subcategories?: string[] }[] = [
  { name: 'Groceries' },
  { name: 'Dining & Takeaway' },
  { name: 'Entertainment' },
  { name: 'Health & Medical' },
  { name: 'Education' },
  { name: 'Utilities' },
  { name: 'Transport' },
  { name: 'Housing/Rent/Mortgage' },
  { name: 'Insurance' },
  { name: 'Shopping' },
  { name: 'Travel' },
  { name: 'Income' },
  { name: 'Transfers' },
  { name: 'Fees & Charges' },
  { name: 'Subscriptions' },
  { name: 'Other' },
];