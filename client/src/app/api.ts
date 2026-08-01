import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type {
  AccountDto,
  AiConfigDto,
  AiConnectionTestResult,
  AiConnectionTestLogEntry,
  CategoryDto,
  CategoryReport,
  DashboardScope,
  ForecastReport,
  HoldingAggregate,
  ImportBatchDto,
  ImportMappingDto,
  InvestmentHoldingDto,
  MemberDto,
  PagedResult,
  PortfolioSummary,
  RuleDto,
  TransactionDto,
  TransactionFilter,
} from '@homefinance/shared';

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Member', 'Account', 'Category', 'Rule', 'Transaction', 'ImportBatch', 'Mapping', 'Insight', 'Setting', 'Backup', 'Investment', 'Price', 'TestHistory'],
  endpoints: (b) => ({
    // ---- Members ----
    listMembers: b.query<MemberDto[], void>({ query: () => '/members', providesTags: ['Member'] }),
    createMember: b.mutation<MemberDto, Partial<MemberDto>>({ query: (body) => ({ url: '/members', method: 'POST', body }), invalidatesTags: ['Member'] }),
    updateMember: b.mutation<MemberDto, { id: string; body: Partial<MemberDto> }>({ query: ({ id, body }) => ({ url: `/members/${id}`, method: 'PUT', body }), invalidatesTags: ['Member'] }),
    deleteMember: b.mutation<void, string>({ query: (id) => ({ url: `/members/${id}`, method: 'DELETE' }), invalidatesTags: ['Member'] }),

    // ---- Accounts ----
    listAccounts: b.query<AccountDto[], void>({ query: () => '/accounts', providesTags: ['Account'] }),
    createAccount: b.mutation<AccountDto, Partial<AccountDto>>({ query: (body) => ({ url: '/accounts', method: 'POST', body }), invalidatesTags: ['Account'] }),
    updateAccount: b.mutation<AccountDto, { id: string; body: Partial<AccountDto> }>({ query: ({ id, body }) => ({ url: `/accounts/${id}`, method: 'PUT', body }), invalidatesTags: ['Account'] }),
    deleteAccount: b.mutation<void, string>({ query: (id) => ({ url: `/accounts/${id}`, method: 'DELETE' }), invalidatesTags: ['Account'] }),

    // ---- Categories ----
    listCategories: b.query<CategoryDto[], void>({ query: () => '/categories', providesTags: ['Category'] }),
    createCategory: b.mutation<CategoryDto, Partial<CategoryDto>>({ query: (body) => ({ url: '/categories', method: 'POST', body }), invalidatesTags: ['Category'] }),
    updateCategory: b.mutation<CategoryDto, { id: string; body: Partial<CategoryDto> }>({ query: ({ id, body }) => ({ url: `/categories/${id}`, method: 'PUT', body }), invalidatesTags: ['Category'] }),
    deleteCategory: b.mutation<void, string>({ query: (id) => ({ url: `/categories/${id}`, method: 'DELETE' }), invalidatesTags: ['Category'] }),

    // ---- Rules ----
    listRules: b.query<RuleDto[], void | { source?: string }>({ query: (arg) => (arg?.source ? `/rules?source=${arg.source}` : '/rules'), providesTags: ['Rule'] }),
    createRule: b.mutation<RuleDto, Partial<RuleDto>>({ query: (body) => ({ url: '/rules', method: 'POST', body }), invalidatesTags: ['Rule', 'Transaction'] }),
    updateRule: b.mutation<RuleDto, { id: string; body: Partial<RuleDto> }>({ query: ({ id, body }) => ({ url: `/rules/${id}`, method: 'PUT', body }), invalidatesTags: ['Rule'] }),
    deleteRule: b.mutation<void, string>({ query: (id) => ({ url: `/rules/${id}`, method: 'DELETE' }), invalidatesTags: ['Rule'] }),
    testRule: b.mutation<{ matches: number }, Partial<RuleDto>>({ query: (body) => ({ url: '/rules/test', method: 'POST', body }) }),
    reorderRules: b.mutation<{ ok: true }, string[]>({ query: (ids) => ({ url: '/rules/reorder', method: 'POST', body: { ids } }), invalidatesTags: ['Rule'] }),
    listSeedDefaults: b.query<any[], void>({ query: () => '/rules/seed-defaults', providesTags: ['Rule'] }),
    restoreSeedRule: b.mutation<any, { matchValue: string }>({ query: (body) => ({ url: '/rules/seed-defaults/restore', method: 'POST', body }), invalidatesTags: ['Rule'] }),

    // ---- Transactions ----
    listTransactions: b.query<PagedResult<TransactionDto & { shareAmount?: number }>, TransactionFilter>({
      query: (f) => ({ url: '/transactions', params: f }),
      providesTags: (r) => r ? [...r.items.map((t) => ({ type: 'Transaction' as const, id: t.id })), 'Transaction'] : ['Transaction'],
    }),
    createTransaction: b.mutation<TransactionDto, any>({ query: (body) => ({ url: '/transactions', method: 'POST', body }), invalidatesTags: ['Transaction'] }),
    updateTransaction: b.mutation<TransactionDto, { id: string; body: any }>({ query: ({ id, body }) => ({ url: `/transactions/${id}`, method: 'PUT', body }), invalidatesTags: ['Transaction'] }),
    deleteTransaction: b.mutation<void, string>({ query: (id) => ({ url: `/transactions/${id}`, method: 'DELETE' }), invalidatesTags: ['Transaction'] }),
    bulkCategorize: b.mutation<{ ok: true }, { ids: string[]; categoryId: string | null; source?: string }>({
      query: (body) => ({ url: '/transactions/bulk', method: 'POST', body }),
      invalidatesTags: ['Transaction'],
    }),
    markReviewed: b.mutation<{ ok: true }, { ids: string[] }>({ query: (body) => ({ url: '/transactions/review', method: 'POST', body }), invalidatesTags: ['Transaction'] }),
    linkTransfer: b.mutation<{ ok: true }, { id: string; linkedTransactionId: string }>({ query: (body) => ({ url: `/transactions/${body.id}/link`, method: 'POST', body: { linkedTransactionId: body.linkedTransactionId } }), invalidatesTags: ['Transaction'] }),
    unlinkTransfer: b.mutation<{ ok: true }, string>({ query: (id) => ({ url: `/transactions/${id}/unlink`, method: 'POST' }), invalidatesTags: ['Transaction'] }),
    suggestCategory: b.mutation<{ categoryId: string | null }, { description: string; amount: number }>({
      query: (body) => ({ url: '/transactions/suggest', method: 'POST', body }),
    }),

    // ---- Imports ----
    uploadImport: b.mutation<any, FormData>({ query: (body) => ({ url: '/imports/upload', method: 'POST', body }) }),
    estimateAi: b.mutation<any, { rows: { description: string; amount: number }[] }>({ query: (body) => ({ url: '/imports/estimate-ai', method: 'POST', body }) }),
    commitImport: b.mutation<any, any>({ query: (body) => ({ url: '/imports/commit', method: 'POST', body }), invalidatesTags: ['Transaction', 'ImportBatch'] }),
    listImportBatches: b.query<ImportBatchDto[], void>({ query: () => '/imports/batches', providesTags: ['ImportBatch'] }),
    deleteImportBatch: b.mutation<void, string>({ query: (id) => ({ url: `/imports/batches/${id}`, method: 'DELETE' }), invalidatesTags: ['Transaction', 'ImportBatch'] }),
    listMappings: b.query<ImportMappingDto[], void>({ query: () => '/imports/mappings', providesTags: ['Mapping'] }),
    createMapping: b.mutation<any, any>({ query: (body) => ({ url: '/imports/mappings', method: 'POST', body }), invalidatesTags: ['Mapping'] }),
    deleteMapping: b.mutation<void, string>({ query: (id) => ({ url: `/imports/mappings/${id}`, method: 'DELETE' }), invalidatesTags: ['Mapping'] }),

    // ---- Dashboards ----
    getOverview: b.query<any, Partial<DashboardScope>>({ query: (s) => ({ url: '/dashboards/overview', params: s }) }),
    getDeepDive: b.query<any, Partial<DashboardScope>>({ query: (s) => ({ url: '/dashboards/deepdive', params: s }) }),

    // ---- Investments ----
    getPortfolio: b.query<PortfolioSummary, { accountId?: string } | void>({ query: (arg) => ({ url: '/investments/portfolio', params: arg ?? {} }), providesTags: ['Investment', 'Price'] }),
    listHoldings: b.query<InvestmentHoldingDto[], { accountId?: string } | void>({ query: (arg) => ({ url: '/investments/holdings', params: arg ?? {} }), providesTags: ['Investment'] }),
    createHolding: b.mutation<InvestmentHoldingDto, any>({ query: (body) => ({ url: '/investments/holdings', method: 'POST', body }), invalidatesTags: ['Investment'] }),
    deleteHolding: b.mutation<void, string>({ query: (id) => ({ url: `/investments/holdings/${id}`, method: 'DELETE' }), invalidatesTags: ['Investment'] }),
    importHoldings: b.mutation<any, FormData>({ query: (body) => ({ url: '/investments/holdings/import', method: 'POST', body }), invalidatesTags: ['Investment'] }),
    refreshPrice: b.mutation<any, { ticker: string }>({ query: (body) => ({ url: '/investments/price/refresh', method: 'POST', body }), invalidatesTags: ['Price'] }),

    // ---- Reports ----
    getIncomeExpenseReport: b.query<CategoryReport, { preset?: string; dateFrom?: string; dateTo?: string; accountId?: string; memberId?: string }>({
      query: (p) => ({ url: '/reports/income-expense-by-category', params: p }),
    }),
    generateForecastReport: b.mutation<ForecastReport, { accountId?: string[]; memberId?: string[] }>({ query: (body) => ({ url: '/ai/forecast-report', method: 'POST', body }) }),

    // ---- AI ----
    aiStatus: b.query<{ enabled: boolean }, void>({ query: () => '/ai/status' }),
    generateInsight: b.mutation<any, { scope?: string }>({ query: (body) => ({ url: '/ai/insight', method: 'POST', body }), invalidatesTags: ['Insight'] }),
    latestInsight: b.query<any, string>({ query: (scope) => ({ url: '/ai/insight/latest', params: { scope } }) }),
    generateForecast: b.mutation<any, { scope?: string }>({ query: (body) => ({ url: '/ai/forecast', method: 'POST', body }) }),
    listAnomalies: b.query<any, { accountId?: string }>({ query: (p) => ({ url: '/ai/anomalies', params: p }) }),
    listSubscriptions: b.query<any, { accountId?: string }>({ query: (p) => ({ url: '/ai/subscriptions', params: p }) }),
    listCloudModels: b.query<{ models: string[]; error?: string }, void>({ query: () => '/ai/models' }),
    testConnection: b.mutation<AiConnectionTestResult, { baseUrl?: string; apiKey?: string }>({ query: (body) => ({ url: '/ai/test-connection', method: 'POST', body }), invalidatesTags: ['TestHistory'] }),
    testHistory: b.query<AiConnectionTestLogEntry[], void>({ query: () => '/ai/test-history', providesTags: ['TestHistory'] }),
    suggestAiCategory: b.mutation<{ categoryId: string | null; suggestedName?: string }, { description: string; amount?: number }>({
      query: (body) => ({ url: '/ai/suggest-category', method: 'POST', body }),
    }),

    // ---- Settings ----
    getAiConfig: b.query<AiConfigDto, void>({ query: () => '/settings/ai', providesTags: ['Setting'] }),
    updateAiConfig: b.mutation<{ ok: true }, Partial<AiConfigDto>>({ query: (body) => ({ url: '/settings/ai', method: 'PUT', body }), invalidatesTags: ['Setting', 'Insight'] }),

    // ---- Backups ----
    listBackups: b.query<{ name: string; size: number; mtime: string }[], void>({ query: () => '/backups', providesTags: ['Backup'] }),
    createBackup: b.mutation<any, void>({ query: () => ({ url: '/backups', method: 'POST' }), invalidatesTags: ['Backup'] }),
    deleteBackup: b.mutation<void, string>({ query: (name) => ({ url: `/backups/${name}`, method: 'DELETE' }), invalidatesTags: ['Backup'] }),
  }),
});

// RTK Query auto-generates hooks on the `api` object (e.g. api.useListMembersQuery).
export const {
  useListMembersQuery, useCreateMemberMutation, useUpdateMemberMutation, useDeleteMemberMutation,
  useListAccountsQuery, useCreateAccountMutation, useUpdateAccountMutation, useDeleteAccountMutation,
  useListCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation,
  useListRulesQuery, useCreateRuleMutation, useUpdateRuleMutation, useDeleteRuleMutation, useTestRuleMutation, useReorderRulesMutation, useListSeedDefaultsQuery, useRestoreSeedRuleMutation,
  useListTransactionsQuery, useCreateTransactionMutation, useUpdateTransactionMutation, useDeleteTransactionMutation, useBulkCategorizeMutation, useMarkReviewedMutation, useLinkTransferMutation, useUnlinkTransferMutation, useSuggestCategoryMutation,
  useUploadImportMutation, useEstimateAiMutation, useCommitImportMutation, useListImportBatchesQuery, useDeleteImportBatchMutation, useListMappingsQuery, useCreateMappingMutation, useDeleteMappingMutation,
  useGetOverviewQuery, useGetDeepDiveQuery,
  useGetPortfolioQuery, useListHoldingsQuery, useCreateHoldingMutation, useDeleteHoldingMutation, useImportHoldingsMutation, useRefreshPriceMutation,
  useGetIncomeExpenseReportQuery, useGenerateForecastReportMutation,
  useAiStatusQuery, useGenerateInsightMutation, useLatestInsightQuery, useGenerateForecastMutation, useListAnomaliesQuery, useListSubscriptionsQuery, useListCloudModelsQuery, useTestConnectionMutation, useTestHistoryQuery, useSuggestAiCategoryMutation,
  useGetAiConfigQuery, useUpdateAiConfigMutation,
  useListBackupsQuery, useCreateBackupMutation, useDeleteBackupMutation,
} = api;
