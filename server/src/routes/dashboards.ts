import { Router } from 'express';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { ownershipMap } from '../services/transactions.js';
import { latestInsight } from '../services/ai.js';
import type { AccountType } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const scopeSchema = z.object({
  memberId: z.string().optional(),
  accountId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

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

// ---- Household overview ----
router.get('/overview', (req, res) => {
  const parsed = scopeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { dateFrom, dateTo } = parsed.data;

  const now = new Date();
  const curStart = dateFrom || monthStart(now);
  const curEnd = dateTo || monthEnd(now);
  const prevDate = addMonths(new Date(curStart), -1);
  const prevStart = monthStart(prevDate);
  const prevEnd = monthEnd(prevDate);

  const d = getDb();
  const txns = d.select().from(schema.transactions).all();
  const accts = d.select().from(schema.accounts).all();
  const cats = d.select().from(schema.categories).all();
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const own = ownershipMap();

  // Total balance across accounts = sum(opening) + sum(transaction amounts)
  const balanceByAccount = new Map<string, number>();
  for (const a of accts) balanceByAccount.set(a.id, a.openingBalance);
  for (const t of txns) balanceByAccount.set(t.accountId, (balanceByAccount.get(t.accountId) || 0) + t.amount);
  const totalBalance = [...balanceByAccount.values()].reduce((s, v) => s + v, 0);

  const inRange = (date: string, a: string, b: string) => date >= a && date <= b;
  const inCur = (date: string) => inRange(date, curStart, curEnd);
  const inPrev = (date: string) => inRange(date, prevStart, prevEnd);

  let curSpend = 0, prevSpend = 0, curIncome = 0, prevIncome = 0;
  const curByCat = new Map<string, number>();
  const prevByCat = new Map<string, number>();
  // monthly income vs expense series (trailing 12)
  const monthlySeries = new Map<string, { income: number; expense: number }>();
  const monthsBack = 12;
  for (let i = monthsBack - 1; i >= 0; i--) {
    const ms = addMonths(now, -i);
    const k = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`;
    monthlySeries.set(k, { income: 0, expense: 0 });
  }

  // category trend per month (trailing 6) for stacked bar
  const trendMonths: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const ms = addMonths(now, -i);
    trendMonths.push(`${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`);
  }
  const catTrend = new Map<string, Map<string, number>>(); // month -> cat -> spend

  for (const t of txns) {
    const month = t.date.slice(0, 7);
    // Transfers are excluded from spend/income totals (Phase 2 §2.4).
    if (!t.isTransfer && monthlySeries.has(month)) {
      const s = monthlySeries.get(month)!;
      if (t.amount < 0) s.expense += -t.amount;
      else s.income += t.amount;
    }
    if (inCur(t.date)) {
      if (!t.isTransfer) {
        if (t.amount < 0) curSpend += -t.amount;
        else curIncome += t.amount;
      }
      if (t.amount < 0 && !t.isTransfer) {
        const cn = catName.get(t.categoryId || '') || 'Uncategorized';
        curByCat.set(cn, (curByCat.get(cn) || 0) + -t.amount);
        if (trendMonths.includes(month)) {
          if (!catTrend.has(month)) catTrend.set(month, new Map());
          catTrend.get(month)!.set(cn, (catTrend.get(month)!.get(cn) || 0) + -t.amount);
        }
      }
    }
    if (inPrev(t.date)) {
      if (!t.isTransfer) {
        if (t.amount < 0) prevSpend += -t.amount;
        else prevIncome += t.amount;
      }
      if (t.amount < 0 && !t.isTransfer) {
        const cn = catName.get(t.categoryId || '') || 'Uncategorized';
        prevByCat.set(cn, (prevByCat.get(cn) || 0) + -t.amount);
      }
    }
  }

  const pct = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10);

  // account balances grouped by type with sparkline (last 6 month end balances approx)
  const accountBalances = accts.map((a) => {
    const tForAcct = txns.filter((t) => t.accountId === a.id);
    // simple sparkline: cumulative balance at each of last 6 month-ends
    let running = a.openingBalance;
    const spark: number[] = [];
    for (let i = 5; i >= 0; i--) {
      const ms = addMonths(now, -i);
      const me = monthEnd(ms);
      const upto = tForAcct.filter((t) => t.date <= me).reduce((s, t) => s + t.amount, 0);
      spark.push(Math.round((a.openingBalance + upto) * 100) / 100);
    }
    return {
      id: a.id,
      name: a.name,
      type: a.type as AccountType,
      balance: Math.round((balanceByAccount.get(a.id) || 0) * 100) / 100,
      isArchived: a.isArchived,
      spark,
      creditLimit: (a as any).creditLimit ?? null,
    };
  });
  const byType = new Map<string, typeof accountBalances>();
  for (const ab of accountBalances) {
    if (!byType.has(ab.type)) byType.set(ab.type, []);
    byType.get(ab.type)!.push(ab);
  }

  // per-person summary (net worth share + spend this month)
  const members = d.select().from(schema.members).all();
  const perPerson = members.map((m) => {
    let netWorth = 0;
    let spend = 0;
    for (const a of accts) {
      const members_ = own.get(a.id);
      const pct = members_?.get(m.id) || 0;
      if (pct > 0) {
        netWorth += ((balanceByAccount.get(a.id) || 0) * pct) / 100;
        for (const t of txns) {
          if (t.accountId === a.id && inCur(t.date) && t.amount < 0 && !t.isTransfer) spend += (-t.amount * pct) / 100;
        }
      }
    }
    return { memberId: m.id, name: m.name, color: m.color, netWorth: Math.round(netWorth * 100) / 100, spend: Math.round(spend * 100) / 100 };
  });

  // recent transactions (last 12)
  const recent = txns
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12)
    .map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: accts.find((a) => a.id === t.accountId)?.name || '',
      date: t.date,
      description: t.description,
      amount: t.amount,
      categoryId: t.categoryId,
      categoryName: catName.get(t.categoryId || '') || null,
      source: t.source,
    }));

  res.json({
    summary: {
      totalBalance: Math.round(totalBalance * 100) / 100,
      currentSpend: Math.round(curSpend * 100) / 100,
      previousSpend: Math.round(prevSpend * 100) / 100,
      spendDeltaPct: pct(curSpend, prevSpend),
      currentIncome: Math.round(curIncome * 100) / 100,
      previousIncome: Math.round(prevIncome * 100) / 100,
      incomeDeltaPct: pct(curIncome, prevIncome),
      netCashFlow: Math.round((curIncome - curSpend) * 100) / 100,
      period: { from: curStart, to: curEnd, prevFrom: prevStart, prevTo: prevEnd },
    },
    spendingByCategory: [...curByCat.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value),
    categoryTrend: trendMonths.map((month) => ({
      month,
      categories: Object.fromEntries([...(catTrend.get(month) || new Map()).entries()].map(([k, v]) => [k, Math.round(v * 100) / 100])),
    })),
    incomeVsExpense: [...monthlySeries.entries()].map(([month, v]) => ({ month, income: Math.round(v.income * 100) / 100, expense: Math.round(v.expense * 100) / 100 })),
    accountsByType: Object.fromEntries([...byType.entries()].map(([type, arr]) => [type, arr])),
    perPerson,
    recent,
    latestInsight: latestInsight('household') || null,
  });
});

// ---- Person / account deep-dive ----
router.get('/deepdive', (req, res) => {
  const parsed = scopeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { memberId, accountId, dateFrom, dateTo } = parsed.data;
  if (!memberId && !accountId) return res.status(400).json({ error: 'memberId or accountId required' });

  const now = new Date();
  const curStart = dateFrom || monthStart(now);
  const curEnd = dateTo || monthEnd(now);
  const prevDate = addMonths(new Date(curStart), -1);
  const prevStart = monthStart(prevDate);
  const prevEnd = monthEnd(prevDate);

  const d = getDb();
  const txns = d.select().from(schema.transactions).all();
  const accts = d.select().from(schema.accounts).all();
  const cats = d.select().from(schema.categories).all();
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const own = ownershipMap();

  // Determine which accounts + percentages apply to this scope
  const scopePct = new Map<string, number>(); // accountId -> percentage
  if (memberId) {
    for (const a of accts) {
      const p = own.get(a.id)?.get(memberId) || 0;
      if (p > 0) scopePct.set(a.id, p);
    }
  } else if (accountId) {
    scopePct.set(accountId, 100);
  }

  const scopedTxns = txns.filter((t) => scopePct.has(t.accountId));
  const shareOf = (t: typeof txns[number]) => (t.amount * (scopePct.get(t.accountId) || 0)) / 100;

  // net worth trend (monthly, trailing 12): sum of account balances * pct at month end
  const netWorthTrend: { month: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ms = addMonths(now, -i);
    const me = monthEnd(ms);
    let v = 0;
    for (const [acctId, p] of scopePct) {
      const a = accts.find((x) => x.id === acctId)!;
      const upto = scopedTxns.filter((t) => t.accountId === acctId && t.date <= me).reduce((s, t) => s + t.amount, 0);
      v += ((a.openingBalance + upto) * p) / 100;
    }
    const k = `${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`;
    netWorthTrend.push({ month: k, value: Math.round(v * 100) / 100 });
  }

  const inCur = (date: string) => date >= curStart && date <= curEnd;
  const inPrev = (date: string) => date >= prevStart && date <= prevEnd;

  let curSpend = 0, prevSpend = 0;
  const curByCat = new Map<string, number>();
  const prevByCat = new Map<string, number>();
  // category trend trailing 6
  const trendMonths: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const ms = addMonths(now, -i);
    trendMonths.push(`${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`);
  }
  const catTrend = new Map<string, Map<string, number>>();
  for (const t of scopedTxns) {
    const sh = shareOf(t);
    const month = t.date.slice(0, 7);
    if (t.isTransfer) continue;
    if (inCur(t.date) && t.amount < 0) {
      curSpend += -sh;
      const cn = catName.get(t.categoryId || '') || 'Uncategorized';
      curByCat.set(cn, (curByCat.get(cn) || 0) + -sh);
    }
    if (inPrev(t.date) && t.amount < 0) {
      prevSpend += -sh;
      const cn = catName.get(t.categoryId || '') || 'Uncategorized';
      prevByCat.set(cn, (prevByCat.get(cn) || 0) + -sh);
    }
    if (t.amount < 0 && trendMonths.includes(month)) {
      const cn = catName.get(t.categoryId || '') || 'Uncategorized';
      if (!catTrend.has(month)) catTrend.set(month, new Map());
      catTrend.get(month)!.set(cn, (catTrend.get(month)!.get(cn) || 0) + -sh);
    }
  }

  // category comparison this vs prev
  const allCats = new Set([...curByCat.keys(), ...prevByCat.keys()]);
  const categoryComparison = [...allCats].map((name) => {
    const cur = curByCat.get(name) || 0;
    const prev = prevByCat.get(name) || 0;
    const delta = prev === 0 ? null : Math.round(((cur - prev) / prev) * 1000) / 10;
    return { name, current: Math.round(cur * 100) / 100, previous: Math.round(prev * 100) / 100, deltaPct: delta, over: cur > prev };
  }).sort((a, b) => b.current - a.current);

  res.json({
    scope: { memberId, accountId, period: { from: curStart, to: curEnd, prevFrom: prevStart, prevTo: prevEnd } },
    netWorthTrend,
    spendByCategory: [...curByCat.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort((a, b) => b.value - a.value),
    categoryTrend: trendMonths.map((month) => ({ month, categories: Object.fromEntries([...(catTrend.get(month) || new Map()).entries()].map(([k, v]) => [k, Math.round(v * 100) / 100])) })),
    categoryComparison,
    currentSpend: Math.round(curSpend * 100) / 100,
    previousSpend: Math.round(prevSpend * 100) / 100,
  });
});

export default router;