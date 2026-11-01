import { Router } from 'express';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { ownershipMap } from '../services/transactions.js';
import type {
  BudgetReport,
  BudgetReportCategoryRow,
  BudgetReportMonth,
  CategoryAnalytics,
  CategoryAnalyticsCategoryRow,
  CategoryAnalyticsMerchantRow,
  CategoryReport,
  CategoryReportRow,
  CategoryType,
} from '@homefinance/shared';

const router = Router();
const db = () => getDb();

function monthStart(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthEnd(date = new Date()): string {
  const e = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const scopeSchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  preset: z.enum(['thisMonth', 'lastMonth', 'thisQuarter', 'ytd', 'last12', 'last24', 'custom']).optional(),
  accountId: z.string().optional(),
  memberId: z.string().optional(),
});

function resolvePeriod(preset?: string, dateFrom?: string, dateTo?: string) {
  const now = new Date();
  switch (preset) {
    case 'lastMonth': {
      const s = addMonths(now, -1);
      return { from: monthStart(s), to: monthEnd(s) };
    }
    case 'thisQuarter': {
      const q = Math.floor(now.getMonth() / 3) * 3;
      const s = new Date(now.getFullYear(), q, 1);
      return { from: monthStart(s), to: monthEnd(addMonths(s, 2)) };
    }
    case 'ytd':
      return { from: `${now.getFullYear()}-01-01`, to: monthEnd(now) };
    case 'last12':
      return { from: monthStart(addMonths(now, -11)), to: monthEnd(now) };
    case 'last24':
      return { from: monthStart(addMonths(now, -23)), to: monthEnd(now) };
    default:
      return { from: dateFrom || monthStart(now), to: dateTo || monthEnd(now) };
  }
}

// Phase 2 §7 — Income vs Expense by Category report.
router.get('/income-expense-by-category', (req, res) => {
  const parsed = scopeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { preset, accountId, memberId } = parsed.data;
  const period = resolvePeriod(preset, parsed.data.dateFrom, parsed.data.dateTo);
  // Previous period of the same length.
  const days = Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000) + 1;
  const prevEnd = new Date(new Date(period.from).getTime() - 86400000);
  const prevFrom = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const prev = { from: iso(prevFrom), to: iso(prevEnd) };

  const d = getDb();
  const cats = d.select().from(schema.categories).all();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const transferCatIds = new Set(cats.filter((c) => c.type === 'transfer').map((c) => c.id));
  let txns = d.select()
    .from(schema.transactions)
    .all()
    .filter((t) => !t.isTransfer && !(t.categoryId != null && transferCatIds.has(t.categoryId)));
  if (accountId) txns = txns.filter((t) => t.accountId === accountId);
  const scopePct = new Map<string, number>();
  if (memberId) {
    const own = ownershipMap();
    for (const a of d.select().from(schema.accounts).all()) {
      const p = own.get(a.id)?.get(memberId) || 0;
      if (p > 0 && (!accountId || a.id === accountId)) scopePct.set(a.id, p);
    }
    txns = txns.filter((t) => scopePct.has(t.accountId));
  }
  const signedShare = (t: { amount: number; accountId: string }) =>
    memberId ? (t.amount * (scopePct.get(t.accountId) || 0)) / 100 : t.amount;

  const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
  const cur = new Map<string, { income: number; expense: number }>();
  const prevMap = new Map<string, { income: number; expense: number }>();
  const monthly = new Map<string, { income: number; expense: number }>();

  for (const t of txns) {
    const catKey = t.categoryId || 'uncategorized';
    if (inRange(t.date, period.from, period.to)) {
      // Monthly trend tracks only the report (current) period so past months
      // are populated and no zero-filled prev-period months leak into the chart.
      const m = t.date.slice(0, 7);
      if (!monthly.has(m)) monthly.set(m, { income: 0, expense: 0 });
      const me = monthly.get(m)!;
      if (!cur.has(catKey)) cur.set(catKey, { income: 0, expense: 0 });
      const e = cur.get(catKey)!;
      const amt = signedShare(t);
      if (amt < 0) { e.expense += -amt; me.expense += -amt; }
      else { e.income += amt; me.income += amt; }
    } else if (inRange(t.date, prev.from, prev.to)) {
      if (!prevMap.has(catKey)) prevMap.set(catKey, { income: 0, expense: 0 });
      const e = prevMap.get(catKey)!;
      const amt = signedShare(t);
      if (amt < 0) e.expense += -amt;
      else e.income += amt;
    }
  }

  const rows: CategoryReportRow[] = [];
  const allKeys = new Set([...cur.keys(), ...prevMap.keys()]);
  for (const key of allKeys) {
    const cat = key === 'uncategorized' ? null : catById.get(key);
    const c = cur.get(key) || { income: 0, expense: 0 };
    const p = prevMap.get(key) || { income: 0, expense: 0 };
    const net = c.income - c.expense;
    const prevNet = p.income - p.expense;
    const deltaPct = prevNet === 0 ? null : Math.round(((net - prevNet) / Math.abs(prevNet)) * 1000) / 10;
    rows.push({
      categoryId: key,
      name: cat?.name || 'Uncategorized',
      type: (cat?.type as CategoryType) ?? null,
      income: round2(c.income),
      expense: round2(c.expense),
      net: round2(net),
      prevIncome: round2(p.income),
      prevExpense: round2(p.expense),
      deltaPct,
    });
  }
  rows.sort((a, b) => b.expense - a.expense || b.income - a.income);

  const totals = {
    income: round2(rows.reduce((s, r) => s + r.income, 0)),
    expense: round2(rows.reduce((s, r) => s + r.expense, 0)),
    net: round2(rows.reduce((s, r) => s + r.net, 0)),
  };
  const monthlyArr = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, income: round2(v.income), expense: round2(v.expense) }));

  const report: CategoryReport = { period: { from: period.from, to: period.to, prevFrom: prev.from, prevTo: prev.to }, rows, totals, monthly: monthlyArr };
  res.json(report);
});

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Category analytics dashboard ----
// Single/multi-category slicing with period-over-period comparison, monthly
// trend (per-category for stacked/line/area), and merchant (description)
// drill-down. In-memory aggregation, consistent with /dashboards and the
// income-expense report above.
const analyticsSchema = scopeSchema.extend({
  categoryId: z.union([z.string(), z.array(z.string())]).optional(),
  includeIncome: z.string().optional(),
});

router.get('/category-analytics', (req, res) => {
  const parsed = analyticsSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { preset, accountId, memberId } = parsed.data;
  const period = resolvePeriod(preset, parsed.data.dateFrom, parsed.data.dateTo);

  // Normalize categoryId to string[] (accepts "id", "id,id", or ["id"]).
  let categoryIds: string[] = [];
  const rawCat = (parsed.data as any).categoryId;
  if (typeof rawCat === 'string') categoryIds = rawCat.split(',').map((s) => s.trim()).filter(Boolean);
  else if (Array.isArray(rawCat)) categoryIds = rawCat.filter(Boolean);
  const includeIncome = String(parsed.data.includeIncome ?? 'false') === 'true';

  // Previous period of the same length.
  const days = Math.round((new Date(period.to).getTime() - new Date(period.from).getTime()) / 86400000) + 1;
  const prevEnd = new Date(new Date(period.from).getTime() - 86400000);
  const prevFrom = new Date(prevEnd.getTime() - (days - 1) * 86400000);
  const prev = { from: iso(prevFrom), to: iso(prevEnd) };

  const d = getDb();
  const cats = d.select().from(schema.categories).all();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const catName = (id: string | null) => (id && catById.get(id)?.name) || 'Uncategorized';
  const catType = (id: string | null): CategoryType | null => {
    if (!id) return null;
    return (catById.get(id)?.type as CategoryType) ?? null;
  };
  const transferCatIds = new Set(cats.filter((c) => c.type === 'transfer').map((c) => c.id));
  const selectedCats = new Set(categoryIds);
  const hasCatFilter = selectedCats.size > 0;
  // Transfer-like (isTransfer flag OR transfer-type category) is excluded from
  // the default spend view, UNLESS its category is explicitly selected — so
  // picking Investment / Credit Card Repayment reveals those movements.
  const transferLike = (t: { isTransfer: boolean; categoryId: string | null }) =>
    t.isTransfer || (t.categoryId != null && transferCatIds.has(t.categoryId));
  const excluded = (t: { isTransfer: boolean; categoryId: string | null }) =>
    transferLike(t) && !(t.categoryId != null && selectedCats.has(t.categoryId));
  let txns = d.select().from(schema.transactions).all().filter((t) => !excluded(t));
  if (hasCatFilter) {
    txns = txns.filter((t) => (t.categoryId ? selectedCats.has(t.categoryId) : false));
  }

  // Account scope: memberId → ownership-weighted share; accountId → single at
  // 100%; otherwise all accounts at 100%.
  const scopePct = new Map<string, number>();
  const scopedAccountIds: string[] | null = accountId ? [accountId] : null;
  if (memberId) {
    const own = ownershipMap();
    const accts = d.select().from(schema.accounts).all();
    for (const a of accts) {
      const p = own.get(a.id)?.get(memberId) || 0;
      if (p > 0) scopePct.set(a.id, p);
    }
    txns = txns.filter((t) => scopePct.has(t.accountId));
  } else if (accountId) {
    scopePct.set(accountId, 100);
    txns = txns.filter((t) => t.accountId === accountId);
  }
  const shareOf = (t: { amount: number; accountId: string }) =>
    (t.amount * (scopePct.get(t.accountId) || 100)) / 100;

  const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
  const cur = new Map<string, { expense: number; income: number }>();
  const prevMap = new Map<string, { expense: number; income: number }>();
  const monthly = new Map<string, { expense: number; income: number }>();
  const byMonthCat = new Map<string, Map<string, number>>(); // month -> catName -> expense
  const byMerchant = new Map<string, { expense: number; count: number }>();

  for (const t of txns) {
    const catKey = t.categoryId || 'uncategorized';
    const sh = shareOf(t);
    if (inRange(t.date, period.from, period.to)) {
      const m = t.date.slice(0, 7);
      if (!monthly.has(m)) monthly.set(m, { expense: 0, income: 0 });
      const me = monthly.get(m)!;
      if (!cur.has(catKey)) cur.set(catKey, { expense: 0, income: 0 });
      const e = cur.get(catKey)!;
      if (t.amount < 0) {
        const exp = -sh;
        e.expense += exp; me.expense += exp;
        const cn = catName(t.categoryId);
        if (!byMonthCat.has(m)) byMonthCat.set(m, new Map());
        byMonthCat.get(m)!.set(cn, (byMonthCat.get(m)!.get(cn) || 0) + exp);
        const mk = t.description;
        const mer = byMerchant.get(mk) || { expense: 0, count: 0 };
        mer.expense += exp; mer.count += 1;
        byMerchant.set(mk, mer);
      } else {
        e.income += sh; me.income += sh;
      }
    } else if (inRange(t.date, prev.from, prev.to)) {
      if (!prevMap.has(catKey)) prevMap.set(catKey, { expense: 0, income: 0 });
      const e = prevMap.get(catKey)!;
      if (t.amount < 0) e.expense += -sh;
      else e.income += sh;
    }
  }

  const curExpenseTotal = [...cur.values()].reduce((s, v) => s + v.expense, 0);
  const curIncomeTotal = [...cur.values()].reduce((s, v) => s + v.income, 0);
  const prevExpenseTotal = [...prevMap.values()].reduce((s, v) => s + v.expense, 0);
  const prevIncomeTotal = [...prevMap.values()].reduce((s, v) => s + v.income, 0);

  const byCategory: CategoryAnalyticsCategoryRow[] = [];
  const allKeys = new Set([...cur.keys(), ...prevMap.keys()]);
  for (const key of allKeys) {
    const c = cur.get(key) || { expense: 0, income: 0 };
    const p = prevMap.get(key) || { expense: 0, income: 0 };
    const net = c.income - c.expense;
    const prevNet = p.income - p.expense;
    const deltaPct = prevNet === 0 ? null : Math.round(((net - prevNet) / Math.abs(prevNet)) * 1000) / 10;
    byCategory.push({
      categoryId: key,
      name: catName(key === 'uncategorized' ? null : key),
      type: catType(key === 'uncategorized' ? null : key),
      expense: round2(c.expense),
      income: round2(c.income),
      net: round2(net),
      prevExpense: round2(p.expense),
      prevIncome: round2(p.income),
      deltaPct,
      sharePct: curExpenseTotal === 0 ? null : Math.round((c.expense / curExpenseTotal) * 1000) / 10,
    });
  }
  byCategory.sort((a, b) => b.expense - a.expense || b.income - a.income);

  const byMerchantRows: CategoryAnalyticsMerchantRow[] = [...byMerchant.entries()]
    .map(([description, v]) => ({
      description,
      expense: round2(v.expense),
      count: v.count,
      sharePct: curExpenseTotal === 0 ? null : Math.round((v.expense / curExpenseTotal) * 1000) / 10,
    }))
    .sort((a, b) => b.expense - a.expense)
    .slice(0, 15);

  const monthlyArr = [...monthly.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, expense: round2(v.expense), income: round2(v.income) }));

  const byMonthCategoryArr = [...byMonthCat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, cats2]) => ({
      month,
      categories: Object.fromEntries([...cats2.entries()].map(([k, v]) => [k, round2(v)])),
    }));

  const totalsDeltaPct = prevExpenseTotal === 0
    ? null
    : Math.round(((curExpenseTotal - prevExpenseTotal) / Math.abs(prevExpenseTotal)) * 1000) / 10;

  const report: CategoryAnalytics = {
    period: { from: period.from, to: period.to, prevFrom: prev.from, prevTo: prev.to },
    scope: { accountIds: scopedAccountIds, memberId: memberId ?? null, categoryIds: hasCatFilter ? categoryIds : null, includeIncome },
    totals: {
      expense: round2(curExpenseTotal),
      income: round2(curIncomeTotal),
      net: round2(curIncomeTotal - curExpenseTotal),
      prevExpense: round2(prevExpenseTotal),
      prevIncome: round2(prevIncomeTotal),
      deltaPct: totalsDeltaPct,
    },
    byCategory,
    monthly: monthlyArr,
    byMonthCategory: byMonthCategoryArr,
    byMerchant: byMerchantRows,
  };
  res.json(report);
});

// ---- Budget report (past trend + overspend analysis) ----
// Current per-category monthly budgets (category_budgets) are applied
// retroactively across the selected period. Compares actual monthly spend
// (scoped + transfer-excluded + ownership-weighted, mirroring category-analytics)
// against the budget. No per-month budget history.
const budgetSchema = scopeSchema.extend({
  categoryId: z.union([z.string(), z.array(z.string())]).optional(),
});

router.get('/budget', (req, res) => {
  const parsed = budgetSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { preset, accountId, memberId } = parsed.data;
  const period = resolvePeriod(preset, parsed.data.dateFrom, parsed.data.dateTo);

  // Normalize categoryId to string[] (accepts "id", "id,id", or ["id"]).
  let categoryIds: string[] = [];
  const rawCat = (parsed.data as any).categoryId;
  if (typeof rawCat === 'string') categoryIds = rawCat.split(',').map((s) => s.trim()).filter(Boolean);
  else if (Array.isArray(rawCat)) categoryIds = rawCat.filter(Boolean);
  const selectedCats = new Set(categoryIds);

  const d = getDb();
  const cats = d.select().from(schema.categories).all();
  const catById = new Map(cats.map((c) => [c.id, c]));
  const budgets = d.select().from(schema.categoryBudgets).all();
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b.monthlyAmount]));
  const expenseCatIds = new Set(cats.filter((c) => c.type !== 'income' && c.type !== 'transfer').map((c) => c.id));

  const transferCatIds = new Set(cats.filter((c) => c.type === 'transfer').map((c) => c.id));
  const transferLike = (t: { isTransfer: boolean; categoryId: string | null }) =>
    t.isTransfer || (t.categoryId != null && transferCatIds.has(t.categoryId));

  // Account/member scoping (ownership-weighted) — same as category-analytics.
  const scopePct = new Map<string, number>();
  const scopedAccountIds: string[] | null = accountId ? [accountId] : null;
  let txns = d.select().from(schema.transactions).all().filter((t) => !transferLike(t));
  if (memberId) {
    const own = ownershipMap();
    const accts = d.select().from(schema.accounts).all();
    for (const a of accts) {
      const p = own.get(a.id)?.get(memberId) || 0;
      if (p > 0) scopePct.set(a.id, p);
    }
    txns = txns.filter((t) => scopePct.has(t.accountId));
  } else if (accountId) {
    scopePct.set(accountId, 100);
    txns = txns.filter((t) => t.accountId === accountId);
  }
  const shareOf = (t: { amount: number; accountId: string }) =>
    (t.amount * (scopePct.get(t.accountId) || 100)) / 100;

  // Month list for the whole period.
  const monthsTotal: string[] = [];
  {
    let cur = new Date(period.from + 'T00:00:00');
    const end = new Date(period.to + 'T00:00:00');
    while (cur <= end) {
      monthsTotal.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
      cur = addMonths(cur, 1);
    }
  }
  const monthsCount = monthsTotal.length || 1;

  // month -> categoryId -> actual expense (only budgeted cats tracked per-cat)
  const monthCatActual = new Map<string, Map<string, number>>();
  // month -> unbudgeted expense
  const monthUnbudgeted = new Map<string, number>();
  for (const m of monthsTotal) {
    monthCatActual.set(m, new Map());
    monthUnbudgeted.set(m, 0);
  }

  const inRange = (date: string) => date >= period.from && date <= period.to;
  for (const t of txns) {
    if (!inRange(t.date)) continue;
    if (t.amount >= 0) continue; // expenses only
    const m = t.date.slice(0, 7);
    if (!monthCatActual.has(m)) continue; // outside month list (shouldn't happen)
    const sh = -shareOf(t); // positive expense amount
    if (t.categoryId && budgetByCat.has(t.categoryId)) {
      const mm = monthCatActual.get(m)!;
      mm.set(t.categoryId, (mm.get(t.categoryId) || 0) + sh);
    } else if (!t.categoryId || expenseCatIds.has(t.categoryId)) {
      // non-budgeted expense category (or uncategorized) → unbudgeted
      monthUnbudgeted.set(m, (monthUnbudgeted.get(m) || 0) + sh);
    }
  }

  // Which budgeted categories are in scope (category filter applies).
  const inScopeBudgetCats = [...budgetByCat.entries()].filter(([cid]) =>
    selectedCats.size === 0 ? true : selectedCats.has(cid),
  );
  const inScopeMonthlyBudgetTotal = inScopeBudgetCats.reduce((s, [, v]) => s + v, 0);

  // Per-month aggregate row.
  const monthly: BudgetReportMonth[] = monthsTotal.map((m) => {
    const budget = round2(inScopeMonthlyBudgetTotal);
    let actual = 0;
    for (const [cid] of inScopeBudgetCats) actual += monthCatActual.get(m)!.get(cid) || 0;
    actual = round2(actual);
    const unbudgeted = round2(monthUnbudgeted.get(m) || 0);
    const variance = round2(actual - budget);
    const adherencePct = budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null;
    return { month: m, budget, actual, unbudgeted, variance, adherencePct };
  });

  // Per-category rows.
  const byCategory: BudgetReportCategoryRow[] = inScopeBudgetCats.map(([cid, monthlyBudget]) => {
    const name = catById.get(cid)?.name || 'Unknown';
    const catMonthly = monthsTotal.map((m) => ({
      month: m,
      budget: round2(monthlyBudget),
      actual: round2(monthCatActual.get(m)!.get(cid) || 0),
    }));
    const actual = round2(catMonthly.reduce((s, x) => s + x.actual, 0));
    const budget = round2(monthlyBudget * monthsCount);
    const variance = round2(actual - budget);
    const variancePct = budget > 0 ? Math.round((variance / budget) * 1000) / 10 : null;
    const monthsOver = catMonthly.filter((x) => x.actual > x.budget).length;
    const monthsWithSpend = catMonthly.filter((x) => x.actual > 0).length;
    return { categoryId: cid, name, monthlyBudget: round2(monthlyBudget), budget, actual, variance, variancePct, monthsOver, monthsWithSpend, monthly: catMonthly };
  });
  byCategory.sort((a, b) => b.variance - a.variance || b.actual - a.actual);

  const totalBudget = round2(inScopeMonthlyBudgetTotal * monthsCount);
  const totalActual = round2(monthly.reduce((s, m) => s + m.actual, 0));
  const totalUnbudgeted = round2(monthly.reduce((s, m) => s + m.unbudgeted, 0));
  const totalVariance = round2(totalActual - totalBudget);
  const totalsVariancePct = totalBudget > 0 ? Math.round((totalVariance / totalBudget) * 1000) / 10 : null;
  const monthsOver = monthly.filter((m) => m.actual > m.budget).length;

  const report: BudgetReport = {
    period: { from: period.from, to: period.to },
    scope: { accountIds: scopedAccountIds, memberId: memberId ?? null, categoryIds: selectedCats.size ? categoryIds : null },
    totals: {
      budget: totalBudget,
      actual: totalActual,
      variance: totalVariance,
      variancePct: totalsVariancePct,
      unbudgeted: totalUnbudgeted,
      monthsOver,
      monthsTotal: monthsCount,
    },
    monthly,
    byCategory,
  };
  res.json(report);
});

export default router;