// Shared DTOs / entity types. Mirrors the Drizzle schema on the server.
import type { AccountType, CategorySource, InsightType, ImportFileFormat, RuleMatchType } from './enums.js';

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
}

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  isCustom: boolean;
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
}

export interface TransactionDto {
  id: string;
  accountId: string;
  date: string; // ISO yyyy-mm-dd
  description: string;
  rawDescription: string | null;
  amount: number; // negative = expense, positive = income
  categoryId: string | null;
  source: CategorySource;
  importBatchId: string | null;
  isTransfer: boolean;
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
  page?: number;
  pageSize?: number;
  sort?: string; // e.g. "date:desc"
}

export interface DashboardScope {
  // exactly one of memberId / accountId (or household-wide if neither set)
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