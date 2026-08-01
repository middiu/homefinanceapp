import { Router } from 'express';
import { z } from 'zod';
import { getDb, schema } from '../db/index.js';
import { ownershipMap } from '../services/transactions.js';
import type { CategoryReport, CategoryReportRow, CategoryType } from '@homefinance/shared';

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
  preset: z.enum(['thisMonth', 'lastMonth', 'thisQuarter', 'ytd', 'last12', 'custom']).optional(),
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
  let txns = d.select().from(schema.transactions).all().filter((t) => !t.isTransfer);
  if (accountId) txns = txns.filter((t) => t.accountId === accountId);
  if (memberId) {
    const own = ownershipMap();
    const memberAccts = new Set<string>();
    for (const [acct, members] of own) if (members.has(memberId)) memberAccts.add(acct);
    txns = txns.filter((t) => memberAccts.has(t.accountId));
  }
  const cats = d.select().from(schema.categories).all();
  const catById = new Map(cats.map((c) => [c.id, c]));

  const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
  const cur = new Map<string, { income: number; expense: number }>();
  const prevMap = new Map<string, { income: number; expense: number }>();
  const monthly = new Map<string, { income: number; expense: number }>();

  for (const t of txns) {
    const m = t.date.slice(0, 7);
    if (!monthly.has(m)) monthly.set(m, { income: 0, expense: 0 });
    const me = monthly.get(m)!;
    const catKey = t.categoryId || 'uncategorized';
    if (inRange(t.date, period.from, period.to)) {
      if (!cur.has(catKey)) cur.set(catKey, { income: 0, expense: 0 });
      const e = cur.get(catKey)!;
      if (t.amount < 0) { e.expense += -t.amount; me.expense += -t.amount; }
      else { e.income += t.amount; me.income += t.amount; }
    } else if (inRange(t.date, prev.from, prev.to)) {
      if (!prevMap.has(catKey)) prevMap.set(catKey, { income: 0, expense: 0 });
      const e = prevMap.get(catKey)!;
      if (t.amount < 0) e.expense += -t.amount;
      else e.income += t.amount;
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

export default router;