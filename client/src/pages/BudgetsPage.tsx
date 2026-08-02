import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Trash2, Sparkles } from 'lucide-react';
import { useListBudgetsQuery, useUpsertBudgetMutation, useDeleteBudgetMutation, useListCategoriesQuery, useGetCategoryAnalyticsQuery, useAiStatusQuery, useGenerateBudgetsMutation, api } from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';
import { JobProgressModal } from '@/components/JobProgressModal';
import { formatAUD } from '@/lib/utils';
import type { BudgetDto } from '@homefinance/shared';

interface BudgetChange {
  categoryId: string;
  categoryName: string;
  previous: number | null;
  new: number;
  reason: string;
}

export default function BudgetsPage() {
  const dispatch = useDispatch();
  const { data: budgets = [], isLoading: budgetsLoading } = useListBudgetsQuery();
  const { data: categories = [] } = useListCategoriesQuery();
  const [upsertBudget] = useUpsertBudgetMutation();
  const [deleteBudget] = useDeleteBudgetMutation();
  const { data: analytics } = useGetCategoryAnalyticsQuery({ preset: 'thisMonth' } as any);
  const { data: aiStatus } = useAiStatusQuery();
  const [generateBudgets] = useGenerateBudgetsMutation();
  const [jobId, setJobId] = useState<string | null>(null);
  const [summary, setSummary] = useState<BudgetChange[] | null>(null);

  const aiEnabled = !!aiStatus?.enabled;

  async function startBudgets() {
    setSummary(null);
    const r: any = await generateBudgets();
    setJobId(r.data?.jobId ?? null);
  }

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
      <PageHeader
        title="Budgets"
        subtitle="Set monthly budgets per category and compare against this month's spend"
        actions={
          <Button variant="outline" size="sm" onClick={startBudgets} disabled={!aiEnabled} title={aiEnabled ? 'Generate / suggest budgets using AI (24-mo history + AU cost-of-living research)' : 'Enable AI in AI & Insights settings first'}>
            <Sparkles className="h-4 w-4" /> AI Budget Assistant
          </Button>
        }
      />

      {summary && summary.length > 0 && (
        <Card className="mb-4 border-primary/40">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI applied {summary.length} budget{summary.length === 1 ? '' : 's'}</CardTitle>
              <CardDescription>Based on 24 months of history + AU cost-of-living research</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSummary(null)}>Dismiss</Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {summary.map((c) => (
                <div key={c.categoryId} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                  <span className="col-span-3 truncate font-medium">{c.categoryName}</span>
                  <span className="col-span-3 text-muted-foreground">{c.previous == null ? 'no budget' : formatAUD(c.previous)} → <span className="font-medium text-foreground">{formatAUD(c.new)}</span></span>
                  <span className="col-span-6 truncate text-xs text-muted-foreground">{c.reason}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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

      <JobProgressModal
        jobId={jobId}
        title="AI Budget Assistant"
        onDone={(result: any) => {
          dispatch(api.util.invalidateTags(['Budget']));
          setSummary(result?.changes ?? []);
        }}
        onClose={() => setJobId(null)}
      />
    </div>
  );
}