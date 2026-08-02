import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
  LineChart, Line, ReferenceLine, AreaChart, Area,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ArrowLeft } from 'lucide-react';
import { useGetBudgetReportQuery, useListAccountsQuery, useListMembersQuery, useListBudgetsQuery } from '@/app/api';
import { PageHeader, StatCard, EmptyState, DeltaBadge } from '@/components/common';
import { MultiCategorySelect } from '@/components/MultiCategorySelect';
import { formatAUD, formatDate, monthLabel, pct } from '@/lib/utils';

export default function BudgetReportPage() {
  const [params, setParams] = useSearchParams();
  const { data: accounts } = useListAccountsQuery();
  const { data: members } = useListMembersQuery();
  const { data: budgets = [] } = useListBudgetsQuery();

  const [preset, setPreset] = useState('last12');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountId, setAccountId] = useState(params.get('accountId') || '');
  const [memberId, setMemberId] = useState(params.get('memberId') || '');
  const [categoryIds, setCategoryIds] = useState<string[]>(
    params.get('categoryId') ? params.get('categoryId')!.split(',').filter(Boolean) : [],
  );

  function syncUrl(next: Partial<{ accountId: string; memberId: string; categoryIds: string[] }>) {
    const p = new URLSearchParams();
    const a = next.accountId !== undefined ? next.accountId : accountId;
    const m = next.memberId !== undefined ? next.memberId : memberId;
    const c = next.categoryIds !== undefined ? next.categoryIds : categoryIds;
    if (a) p.set('accountId', a);
    if (m) p.set('memberId', m);
    if (c.length) p.set('categoryId', c.join(','));
    setParams(p, { replace: true });
  }

  const reqParams = useMemo(
    () => ({
      preset: preset === 'custom' ? undefined : preset,
      dateFrom: preset === 'custom' ? dateFrom || undefined : undefined,
      dateTo: preset === 'custom' ? dateTo || undefined : undefined,
      accountId: accountId || undefined,
      memberId: memberId || undefined,
      categoryId: categoryIds.length ? categoryIds : undefined,
    }),
    [preset, dateFrom, dateTo, accountId, memberId, categoryIds],
  );
  const { data, isLoading } = useGetBudgetReportQuery(reqParams as any);

  const focused = categoryIds.length === 1 ? categoryIds[0] : null;

  // Cumulative variance (running Σ variance) for the area chart.
  const cumulative = useMemo(() => {
    if (!data) return [];
    let running = 0;
    return data.monthly.map((m) => {
      running += m.variance;
      return { month: monthLabel(m.month), cumulative: Math.round(running * 100) / 100 };
    });
  }, [data]);

  const topOverspent = useMemo(() => {
    if (!data) return [];
    return [...data.byCategory].filter((c) => c.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 10);
  }, [data]);

  const hasBudgets = budgets.length > 0;

  return (
    <div>
      <PageHeader title="Budget report" subtitle="Past trend, overspend analysis, budget vs actual over time" />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-40">
          <option value="thisMonth">This month</option>
          <option value="lastMonth">Last month</option>
          <option value="thisQuarter">This quarter</option>
          <option value="ytd">Year to date</option>
          <option value="last12">Last 12 months</option>
          <option value="last24">Last 24 months</option>
          <option value="custom">Custom</option>
        </Select>
        {preset === 'custom' && <>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </>}
        <Select value={accountId} onChange={(e) => { setAccountId(e.target.value); syncUrl({ accountId: e.target.value }); }} className="w-40">
          <option value="">All accounts</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={memberId} onChange={(e) => { setMemberId(e.target.value); syncUrl({ memberId: e.target.value }); }} className="w-40">
          <option value="">All members</option>
          {members?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <MultiCategorySelect
          value={categoryIds}
          onChange={(ids) => { setCategoryIds(ids); syncUrl({ categoryIds: ids }); }}
        />
        {focused && (
          <Button variant="ghost" size="sm" onClick={() => { setCategoryIds([]); syncUrl({ categoryIds: [] }); }}>
            <ArrowLeft className="h-4 w-4" /> Back to all
          </Button>
        )}
      </div>

      {isLoading || !data ? <p className="text-muted-foreground">Loading report…</p> : !hasBudgets ? (
        <EmptyState message="No budgets set. Set monthly budgets on the Budgets page first, then come back to see the trend." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Period {formatDate(data.period.from)} – {formatDate(data.period.to)}</span>
            <span>·</span>
            <span>{data.totals.monthsTotal} month{data.totals.monthsTotal === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{data.byCategory.length} budgeted categor{data.byCategory.length === 1 ? 'y' : 'ies'}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Total budget" value={formatAUD(data.totals.budget)} hint={`${data.totals.monthsTotal} mo`} />
            <StatCard label="Actual spend" value={formatAUD(data.totals.actual)} />
            <StatCard label="Variance" value={formatAUD(data.totals.variance)} tone={data.totals.variance > 0 ? 'negative' : 'positive'} hint={data.totals.variancePct == null ? undefined : pct(data.totals.variancePct)} />
            <StatCard label="Adherence" value={data.totals.budget > 0 ? pct(Math.round((data.totals.actual / data.totals.budget) * 1000) / 10) : '—'} tone={data.totals.actual <= data.totals.budget ? 'positive' : 'negative'} />
            <StatCard label="Months over" value={`${data.totals.monthsOver}/${data.totals.monthsTotal}`} tone={data.totals.monthsOver > 0 ? 'negative' : 'positive'} />
            <StatCard label="Unbudgeted" value={formatAUD(data.totals.unbudgeted)} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Actual vs budget by month</CardTitle><CardDescription>Budget is the current monthly target applied across the period</CardDescription></CardHeader>
              <CardContent>
                {data.monthly.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.monthly.map((m) => ({ month: monthLabel(m.month), Budget: m.budget, Actual: m.actual }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Budget" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Actual" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Overspend by month</CardTitle><CardDescription>Actual − budget (red = over, green = under)</CardDescription></CardHeader>
              <CardContent>
                {data.monthly.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.monthly.map((m) => ({ month: monthLabel(m.month), variance: m.variance }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <ReferenceLine y={0} stroke="#666" />
                      <Bar dataKey="variance" radius={[3, 3, 0, 0]}>
                        {data.monthly.map((m, i) => (
                          <Cell key={i} fill={m.variance > 0 ? '#ef4444' : m.variance < 0 ? '#10b981' : '#6b7280'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Adherence over time</CardTitle><CardDescription>Actual ÷ budget (%) — below 100% = under budget</CardDescription></CardHeader>
              <CardContent>
                {data.monthly.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data.monthly.map((m) => ({ month: monthLabel(m.month), adherence: m.adherencePct }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                      <Tooltip formatter={(v: any) => (v == null ? '—' : `${Number(v)}%`)} />
                      <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" />
                      <Line dataKey="adherence" stroke="#f59e0b" type="monotone" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Cumulative variance</CardTitle><CardDescription>Running Σ(actual − budget) over the period</CardDescription></CardHeader>
              <CardContent>
                {cumulative.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={cumulative}>
                      <defs>
                        <linearGradient id="cumVar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <ReferenceLine y={0} stroke="#666" />
                      <Area dataKey="cumulative" stroke="#6366f1" strokeWidth={2} fill="url(#cumVar)" type="monotone" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Budget vs actual by category</CardTitle><CardDescription>Click a row to focus · period totals</CardDescription></CardHeader>
            <CardContent>
              {data.byCategory.length === 0 ? <EmptyState message="No budgeted categories in scope" /> : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-3">Category</span>
                    <span className="col-span-2 text-right">Monthly</span>
                    <span className="col-span-2 text-right">Budget</span>
                    <span className="col-span-2 text-right">Actual</span>
                    <span className="col-span-1 text-right">Variance</span>
                    <span className="col-span-1 text-right">Over</span>
                    <span className="col-span-1 text-right">Δ%</span>
                  </div>
                  {data.byCategory.map((c) => {
                    const over = c.variance > 0;
                    return (
                      <button
                        key={c.categoryId}
                        onClick={() => { setCategoryIds([c.categoryId]); syncUrl({ categoryIds: [c.categoryId] }); }}
                        className={`grid w-full grid-cols-12 items-center gap-2 rounded-md border px-2 py-2 text-left text-sm hover:bg-muted/40 ${over ? 'border-red-500/30' : 'border-border'}`}
                      >
                        <span className="col-span-3 truncate font-medium">{c.name}</span>
                        <span className="col-span-2 text-right text-muted-foreground">{formatAUD(c.monthlyBudget)}</span>
                        <span className="col-span-2 text-right">{formatAUD(c.budget)}</span>
                        <span className="col-span-2 text-right">{formatAUD(c.actual)}</span>
                        <span className={`col-span-1 text-right ${over ? 'text-red-400' : 'text-emerald-400'}`}>{formatAUD(c.variance)}</span>
                        <span className="col-span-1 text-right text-xs text-muted-foreground">{c.monthsOver}/{data.totals.monthsTotal}</span>
                        <span className="col-span-1 text-right"><DeltaBadge delta={c.variancePct} /></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader><CardTitle>Top overspent categories</CardTitle><CardDescription>Highest over-budget categories in the period</CardDescription></CardHeader>
            <CardContent>
              {topOverspent.length === 0 ? <EmptyState message="No categories over budget in the period 🎉" /> : (
                <ResponsiveContainer width="100%" height={Math.max(200, topOverspent.length * 36)}>
                  <BarChart data={topOverspent.map((c) => ({ name: c.name.length > 18 ? `${c.name.slice(0, 17)}…` : c.name, variance: c.variance }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                    <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                    <Bar dataKey="variance" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}