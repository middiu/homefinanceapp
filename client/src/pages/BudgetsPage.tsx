import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2 } from 'lucide-react';
import { useListBudgetsQuery, useUpsertBudgetMutation, useDeleteBudgetMutation, useListCategoriesQuery, useGetCategoryAnalyticsQuery } from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';
import { formatAUD } from '@/lib/utils';
import type { BudgetDto } from '@homefinance/shared';

export default function BudgetsPage() {
  const { data: budgets = [], isLoading: budgetsLoading } = useListBudgetsQuery();
  const { data: categories = [] } = useListCategoriesQuery();
  const [upsertBudget] = useUpsertBudgetMutation();
  const [deleteBudget] = useDeleteBudgetMutation();
  const { data: analytics } = useGetCategoryAnalyticsQuery({ preset: 'thisMonth' } as any);

  const budgetByCat = useMemo(() => new Map(budgets.map((b: BudgetDto) => [b.categoryId, b.monthlyAmount])), [budgets]);
  const actualByCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of analytics?.byCategory ?? []) m.set(r.categoryId, r.expense);
    return m;
  }, [analytics]);

  // local editable values keyed by categoryId
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    const d: Record<string, string> = {};
    for (const c of categories) {
      const v = budgetByCat.get(c.id);
      d[c.id] = v != null ? String(v) : '';
    }
    setDrafts(d);
  }, [categories, budgetByCat]);

  const expenseCategories = categories.filter((c) => c.type !== 'income' && c.type !== 'transfer');
  const nameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  function commit(categoryId: string) {
    const raw = drafts[categoryId];
    const val = Number(raw);
    if (!raw || isNaN(val) || val <= 0) {
      deleteBudget(categoryId);
      return;
    }
    upsertBudget({ categoryId, monthlyAmount: Math.round(val * 100) / 100 });
  }

  const chartData = budgets.map((b: BudgetDto) => ({
    name: b.categoryName.length > 14 ? `${b.categoryName.slice(0, 13)}…` : b.categoryName,
    Budget: b.monthlyAmount,
    Actual: Math.round((actualByCat.get(b.categoryId) || 0) * 100) / 100,
  }));

  const totalBudget = budgets.reduce((s: number, b: BudgetDto) => s + b.monthlyAmount, 0);
  const totalActual = budgets.reduce((s: number, b: BudgetDto) => s + (actualByCat.get(b.categoryId) || 0), 0);
  const delta = Math.round((totalActual - totalBudget) * 100) / 100;

  return (
    <div>
      <PageHeader title="Budgets" subtitle="Set monthly budgets per category and compare against this month's spend" />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Category budgets</CardTitle><CardDescription>Enter a monthly amount; clears when empty</CardDescription></CardHeader>
          <CardContent className="space-y-1.5">
            {budgetsLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
              expenseCategories.length === 0 ? <EmptyState message="No expense categories" /> :
              expenseCategories.map((c) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm">{c.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min={0}
                      step="10"
                      value={drafts[c.id] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                      onBlur={() => commit(c.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="h-8 w-24 text-right"
                    />
                    {budgetByCat.has(c.id) && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Clear budget" onClick={() => { deleteBudget(c.id); setDrafts((d) => ({ ...d, [c.id]: '' })); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            }
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Budget vs actual</CardTitle>
              <CardDescription>This month</CardDescription>
            </div>
            <div className="text-right text-sm">
              <div className="text-muted-foreground">Total budget {formatAUD(totalBudget)}</div>
              <div className={delta > 0 ? 'text-red-400' : 'text-emerald-400'}>
                {delta > 0 ? 'over' : 'under'} {formatAUD(Math.abs(delta))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? <EmptyState message="No budgets set — enter amounts on the left" /> : (
              <ResponsiveContainer width="100%" height={Math.max(260, chartData.length * 36)}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Budget" fill="#6366f1" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="Actual" fill="#ef4444" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* full-width table of all budgets vs actual */}
      <Card className="mt-4">
        <CardHeader><CardTitle>All budgets</CardTitle><CardDescription>Monthly budget · this month's spend · remaining</CardDescription></CardHeader>
        <CardContent>
          {budgets.length === 0 ? <EmptyState message="No budgets set" /> : (
            <div className="space-y-1">
              <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                <span className="col-span-5">Category</span>
                <span className="col-span-2 text-right">Budget</span>
                <span className="col-span-2 text-right">Spent</span>
                <span className="col-span-3 text-right">Remaining</span>
              </div>
              {budgets.map((b: BudgetDto) => {
                const actual = actualByCat.get(b.categoryId) || 0;
                const rem = Math.round((b.monthlyAmount - actual) * 100) / 100;
                return (
                  <div key={b.categoryId} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                    <span className="col-span-5 truncate">{b.categoryName}</span>
                    <span className="col-span-2 text-right">{formatAUD(b.monthlyAmount)}</span>
                    <span className="col-span-2 text-right text-red-400">{formatAUD(actual)}</span>
                    <span className={`col-span-3 text-right ${rem >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatAUD(rem)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}