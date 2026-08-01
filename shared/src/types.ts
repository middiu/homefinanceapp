// Shared DTOs / entity types. Mirrors the Drizzle schema on the server.
import type {
  AccountType,
  CategorySource,
  InsightType,
  ImportFileFormat,
  RuleMatchType,
  RuleSource,
  CategoryType,
} from './enums.js';

export interface MemberDto {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface OwnershipDto {
  memberId: string;
  percentage: number; // 0-100
}

export interface AccountDto {
  id: string;
  name: string;
  institution: string | null;
  type: AccountType;
  currency: string;
  openingBalance: number;
  isArchived: boolean;
  createdAt: string;
  ownership: OwnershipDto[];
  // Phase 2 §2 — credit card linking
  linkedRepaymentAccountId: string | null;
  creditLimit: number | null;
  statementClosingDay: number | null;
  paymentDueDay: number | null;
}

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  isCustom: boolean;
  type: CategoryType | null; // Phase 2 §7.3
  essential: boolean | null; // true = essential/need, false = discretionary/want, null = untagged
}

// Per-category monthly budget (spending plan).
export interface BudgetDto {
  categoryId: string;
  categoryName: string;
  monthlyAmount: number;
}

// Runtime-detected recurring subscription (computed on demand, not persisted).
export interface SubscriptionDto {
  description: string;
  amount: number;
  lastDate: string;
  nextDate: string | null;
  count: number;
}

// Runtime-detected spending anomaly (computed on demand, not persisted).
export interface AnomalyDto {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryId: string | null;
  reason: string;
}

export interface RuleDto {
  id: string;
  matchType: RuleMatchType;
  matchValue: string;
  amountMin: number | null;
  amountMax: number | null;
  categoryId: string;
  priority: number;
  isActive: boolean;
  ruleSource: RuleSource; // Phase 2 §3.3
  updatedFromAiAt: string | null;
  seedVersion: string | null;
}

export interface TransactionDto {
  id: string;
  accountId: string;
  date: string; // ISO yyyy-mm-dd
  time: string | null; // HH:mm:ss when the export carries a time, else null
  description: string;
  rawDescription: string | null;
  amount: number; // negative = expense, positive = income
  categoryId: string | null;
  source: CategorySource;
  importBatchId: string | null;
  isTransfer: boolean;
  linkedTransactionId: string | null; // Phase 2 §2.3
  needsReview: boolean; // Phase 2 §3.3
  balance: number | null;
  createdAt: string;
}

export interface ImportBatchDto {
  id: string;
  accountId: string;
  importedAt: string;
  fileName: string;
  fileFormat: ImportFileFormat;
  rowCount: number;
  duplicateCount: number;
  aiCategorizedCount: number; // Phase 2 §3.4
}

export interface ImportMappingDto {
  id: string;
  name: string;
  accountId: string | null;
  format: ImportFileFormat;
  columnMap: Record<string, string | null>;
  hasHeader: boolean;
  dateFormat: string | null;
  amountSignConvention: 'auto' | 'negIsExpense' | 'posIsExpense';
}

export interface AiInsightDto {
  id: string;
  generatedAt: string;
  type: InsightType;
  scope: string; // 'household' | member id | account id
  content: string;
  relatedPeriod: string;
}

export interface AiConfigDto {
  enabled: boolean;
  baseUrl: string;
  model: string;
  // apiKey is never sent to the client
  hasApiKey: boolean;
  digestCron: string;
  autoCategorize: boolean; // Phase 2 §3.2
}

// Phase 2 §5 — AI connection test result
export interface AiConnectionTestResult {
  ok: boolean;
  latencyMs: number | null;
  errorCategory: 'auth' | 'network' | 'url' | 'unexpected' | null;
  message: string;
  models?: string[];
  testedAt: string;
}

export interface AiConnectionTestLogEntry {
  id: string;
  testedAt: string;
  outcome: 'success' | 'failure';
  latencyMs: number | null;
  errorCategory: string | null;
}

// API filter primitives — reused by dashboards and the grid (§3.4.3).
export interface TransactionFilter {
  accountId?: string[];
  categoryId?: string[];
  memberId?: string[];
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  search?: string;
  needsReview?: boolean; // Phase 2 §3.2
  isTransfer?: boolean; // Phase 2 §2
  page?: number;
  pageSize?: number;
  sort?: string; // e.g. "date:desc"
}

export interface DashboardScope {
  memberId?: string | null;
  accountId?: string | null;
  dateFrom?: string;
  dateTo?: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Phase 2 §4 — Investments
export interface InvestmentHoldingDto {
  id: string;
  accountId: string;
  ticker: string;
  purchaseDate: string;
  quantity: number;
  purchasePrice: number;
  fees: number | null;
  importBatchId: string | null;
  createdAt: string;
}

export interface PriceSnapshotDto {
  id: string;
  ticker: string;
  price: number;
  currency: string;
  snapshotDate: string;
  fetchedAt: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPct: number | null;
  holdings: HoldingAggregate[];
  allocation: { ticker: string; value: number }[];
  trend: { date: string; value: number; cost: number }[];
  stale: boolean;
}

export interface HoldingAggregate {
  ticker: string;
  quantity: number;
  avgCost: number;
  cost: number;
  currentPrice: number | null;
  currentPriceAt: string | null;
  currency: string | null;
  value: number | null;
  gain: number | null;
  gainPct: number | null;
  lots: InvestmentHoldingDto[];
}

// Phase 2 §7 — Income vs Expense by Category report
export interface CategoryReportRow {
  categoryId: string;
  name: string;
  type: CategoryType | null;
  income: number;
  expense: number;
  net: number;
  prevIncome: number;
  prevExpense: number;
  deltaPct: number | null;
}

export interface CategoryReport {
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  rows: CategoryReportRow[];
  totals: { income: number; expense: number; net: number };
  monthly: { month: string; income: number; expense: number }[];
}

// Category analytics dashboard — single/multi-category slicing + drill-down.
export interface CategoryAnalyticsCategoryRow {
  categoryId: string;
  name: string;
  type: CategoryType | null;
  expense: number;
  income: number;
  net: number;
  prevExpense: number;
  prevIncome: number;
  deltaPct: number | null;
  sharePct: number | null;
}

export interface CategoryAnalyticsMerchantRow {
  description: string;
  expense: number;
  count: number;
  sharePct: number | null;
}

export interface CategoryAnalytics {
  period: { from: string; to: string; prevFrom: string; prevTo: string };
  scope: { accountIds: string[] | null; memberId: string | null; categoryIds: string[] | null; includeIncome: boolean };
  totals: { expense: number; income: number; net: number; prevExpense: number; prevIncome: number; deltaPct: number | null };
  byCategory: CategoryAnalyticsCategoryRow[];
  monthly: { month: string; expense: number; income: number }[];
  byMonthCategory: { month: string; categories: Record<string, number> }[];
  byMerchant: CategoryAnalyticsMerchantRow[];
}

// Phase 2 §8 — 12-month forecast report
export interface ForecastReport {
  history: { month: string; income: number; expense: number; net: number; actual: true }[];
  forecast: { month: string; income: number; expense: number; net: number; cumulative: number; actual: false }[];
  recurring: { description: string; amount: number; monthly: number }[];
  narrative: string;
}