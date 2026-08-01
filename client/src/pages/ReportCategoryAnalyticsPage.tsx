import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Download, ArrowLeft } from 'lucide-react';
import { useGetCategoryAnalyticsQuery, useListAccountsQuery, useListMembersQuery, useListCategoriesQuery } from '@/app/api';
import { PageHeader, StatCard, EmptyState, DeltaBadge } from '@/components/common';
import { MultiCategorySelect } from '@/components/MultiCategorySelect';
import { formatAUD, formatDate, monthLabel, CHART_COLORS, pct } from '@/lib/utils';
import type { CategoryAnalytics } from '@homefinance/shared';

type ChartType = 'stacked' | 'lines' | 'area';

export default function ReportCategoryAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: accounts } = useListAccountsQuery();
  const { data: members } = useListMembersQuery();
  const { data: categories } = useListCategoriesQuery();

  // State is the source of truth, seeded from URL on first render.
  const [preset, setPreset] = useState('last12');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountId, setAccountId] = useState(params.get('accountId') || '');
  const [memberId, setMemberId] = useState(params.get('memberId') || '');
  const [categoryIds, setCategoryIds] = useState<string[]>(
    params.get('categoryId') ? params.get('categoryId')!.split(',').filter(Boolean) : [],
  );
  const [includeIncome, setIncludeIncome] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('stacked');

  const focused = categoryIds.length === 1 ? categoryIds[0] : null;

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
      includeIncome,
    }),
    [preset, dateFrom, dateTo, accountId, memberId, categoryIds, includeIncome],
  );
  const { data, isLoading } = useGetCategoryAnalyticsQuery(reqParams as any);

  const catNames = useMemo(
    () => Array.from(new Set((data?.byMonthCategory ?? []).flatMap((m) => Object.keys(m.categories) as string[]))) as string[],
    [data],
  );

  // name -> essential flag (true=essential, false=discretionary, null=untagged)
  const essentialByName = useMemo(() => {
    const m = new Map<string, boolean | null>();
    for (const c of categories ?? []) m.set(c.name, c.essential ?? null);
    return m;
  }, [categories]);

  // Essential vs discretionary per month (stacked)
  const essentialData = useMemo(() => {
    if (!data) return [];
    return data.byMonthCategory.map((mo) => {
      let essential = 0, discretionary = 0, untagged = 0;
      for (const [name, val] of Object.entries(mo.categories)) {
        const e = essentialByName.get(name);
        if (e === true) essential += val;
        else if (e === false) discretionary += val;
        else untagged += val;
      }
      return { month: monthLabel(mo.month), Essential: Math.round(essential * 100) / 100, Discretionary: Math.round(discretionary * 100) / 100, Untagged: Math.round(untagged * 100) / 100 };
    });
  }, [data, essentialByName]);

  // Top-5 categories by total expense across the period
  const top5 = useMemo(() => {
    if (!data) return { names: [] as string[], rows: [] as { month: string; [k: string]: number | string }[] };
    const totals = new Map<string, number>();
    for (const mo of data.byMonthCategory) {
      for (const [name, val] of Object.entries(mo.categories)) {
        totals.set(name, (totals.get(name) || 0) + val);
      }
    }
    const names = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
    const rows = data.byMonthCategory.map((mo) => {
      const r: { month: string; [k: string]: number | string } = { month: monthLabel(mo.month) };
      for (const n of names) r[n] = mo.categories[n] ?? 0;
      return r;
    });
    return { names, rows };
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const header = ['Category', 'Type', 'Expense', 'Income', 'Net', 'Prev expense', 'Prev income', 'Δ%', 'Share %'];
    const lines = data.byCategory.map((r) =>
      [r.name, r.type ?? '', r.expense, r.income, r.net, r.prevExpense, r.prevIncome, r.deltaPct ?? '', r.sharePct ?? ''].join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `category-analytics-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function drillMerchant(desc: string) {
    if (!data) return;
    const p = new URLSearchParams();
    if (categoryIds.length) p.set('categoryId', categoryIds.join(','));
    if (data.period.from) p.set('dateFrom', data.period.from);
    if (data.period.to) p.set('dateTo', data.period.to);
    if (accountId) p.set('accountId', accountId);
    if (memberId) p.set('memberId', memberId);
    p.set('search', desc);
    navigate(`/transactions?${p.toString()}`);
  }

  function focusCategory(id: string) {
    setCategoryIds([id]);
    syncUrl({ categoryIds: [id] });
  }
  function clearFocus() {
    setCategoryIds([]);
    syncUrl({ categoryIds: [] });
  }

  return (
    <div>
      <PageHeader
        title="Category analytics"
        subtitle="Slice spending by one or more categories, switch chart types, drill into merchants"
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}><Download className="h-4 w-4" /> Export CSV</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-40">
          <option value="thisMonth">This month</option>
          <option value="lastMonth">Last month</option>
          <option value="thisQuarter">This quarter</option>
          <option value="ytd">Year to date</option>
          <option value="last12">Last 12 months</option>
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
        <Select value={includeIncome ? 'true' : 'false'} onChange={(e) => setIncludeIncome(e.target.value === 'true')} className="w-44">
          <option value="false">Expense only</option>
          <option value="true">Income + expense</option>
        </Select>
        {focused && (
          <Button variant="ghost" size="sm" onClick={clearFocus}><ArrowLeft className="h-4 w-4" /> Back to all</Button>
        )}
      </div>

      {isLoading || !data ? <p className="text-muted-foreground">Loading analytics…</p> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Period {formatDate(data.period.from)} – {formatDate(data.period.to)}</span>
            <span>·</span>
            <span>Prev {formatDate(data.period.prevFrom)} – {formatDate(data.period.prevTo)}</span>
            <span>·</span>
            <span>{data.byCategory.length} categor{data.byCategory.length === 1 ? 'y' : 'ies'} · {data.byMerchant.length} merchants</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Total expense" value={formatAUD(data.totals.expense)} delta={data.totals.deltaPct} />
            <StatCard label="Prev expense" value={formatAUD(data.totals.prevExpense)} />
            {includeIncome
              ? <StatCard label="Total income" value={formatAUD(data.totals.income)} />
              : <StatCard label="Net" value={formatAUD(data.totals.net)} tone={data.totals.net >= 0 ? 'positive' : 'negative'} />}
            <StatCard label="Categories" value={String(data.byCategory.length)} />
            <StatCard label="Merchants" value={String(data.byMerchant.length)} />
            <StatCard label="Period" value={presetLabel(preset)} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Share of spend</CardTitle><CardDescription>Selected categories · this period</CardDescription></CardHeader>
              <CardContent>
                {data.byCategory.filter((r) => r.expense > 0).length === 0 ? <EmptyState message="No spending in period" /> : (
                  <ResponsiveContainer width="100%" height={340}>
                    <PieChart>
                      <Pie data={data.byCategory.filter((r) => r.expense > 0).map((r) => ({ name: r.name, value: r.expense }))} dataKey="value" nameKey="name" innerRadius={70} outerRadius={115} paddingAngle={2}>
                        {data.byCategory.filter((r) => r.expense > 0).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader className="flex-row items-center justify-between">
                <div><CardTitle>Monthly trend</CardTitle><CardDescription>Expense per category over the period</CardDescription></div>
                <Select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} className="w-32">
                  <option value="stacked">Stacked bar</option>
                  <option value="lines">Lines</option>
                  <option value="area">Area</option>
                </Select>
              </CardHeader>
              <CardContent>
                {data.byMonthCategory.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={340}>
                    {renderTrend(chartType, data, catNames)}
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Top merchants</CardTitle><CardDescription>By expense · click a bar to drill into transactions</CardDescription></CardHeader>
            <CardContent>
              {data.byMerchant.length === 0 ? <EmptyState message="No merchants in period" /> : (
                <ResponsiveContainer width="100%" height={Math.max(360, data.byMerchant.length * 34)}>
                  <BarChart data={data.byMerchant.map((m) => ({ description: m.description, expense: m.expense }))} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="description" tick={{ fontSize: 11 }} width={180} tickFormatter={(s: string) => (s.length > 32 ? `${s.slice(0, 31)}…` : s)} />
                    <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                    <Bar dataKey="expense" fill="#3b82f6" radius={[0, 4, 4, 0]} onClick={(p: any) => drillMerchant(p.payload?.description ?? p.description)} cursor="pointer" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader><CardTitle>Category comparison</CardTitle><CardDescription>Click a row to focus · Δ vs previous period</CardDescription></CardHeader>
            <CardContent>
              {data.byCategory.length === 0 ? <EmptyState message="No transactions in period" /> : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-4">Category</span>
                    <span className="col-span-2 text-right">Expense</span>
                    {includeIncome && <span className="col-span-2 text-right">Income</span>}
                    <span className="col-span-2 text-right">Share</span>
                    <span className="col-span-2 text-right">Δ vs prev</span>
                  </div>
                  {data.byCategory.map((r) => (
                    <button
                      key={r.categoryId}
                      onClick={() => r.categoryId !== 'uncategorized' && focusCategory(r.categoryId)}
                      className={`grid w-full grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-left text-sm ${r.categoryId !== 'uncategorized' ? 'hover:bg-muted/40 cursor-pointer' : ''}`}
                    >
                      <span className="col-span-4 truncate">{r.name}</span>
                      <span className="col-span-2 text-right text-red-400">{formatAUD(r.expense)}</span>
                      {includeIncome && <span className="col-span-2 text-right text-emerald-400">{formatAUD(r.income)}</span>}
                      <span className="col-span-2 text-right text-muted-foreground">{r.sharePct == null ? '—' : pct(r.sharePct)}</span>
                      <span className="col-span-2 text-right"><DeltaBadge delta={r.deltaPct} /></span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Essential vs discretionary</CardTitle><CardDescription>Monthly spend split by category tag</CardDescription></CardHeader>
              <CardContent>
                {essentialData.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={essentialData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Essential" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="Discretionary" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Untagged" stackId="a" fill="#6b7280" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Top-5 categories</CardTitle><CardDescription>Highest-spend categories over time</CardDescription></CardHeader>
              <CardContent>
                {top5.names.length === 0 ? <EmptyState message="No data in period" /> : (
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={top5.rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {top5.names.map((c, i) => (
                        <Area key={c} dataKey={c} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} stroke={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function presetLabel(p: string): string {
  switch (p) {
    case 'thisMonth': return 'This month';
    case 'lastMonth': return 'Last month';
    case 'thisQuarter': return 'This quarter';
    case 'ytd': return 'YTD';
    case 'last12': return '12 mo';
    case 'custom': return 'Custom';
    default: return p;
  }
}

function renderTrend(type: ChartType, data: CategoryAnalytics, catNames: string[]) {
  const chartData = data.byMonthCategory.map((m) => ({ month: monthLabel(m.month), ...m.categories }));
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />;
  const xAxis = <XAxis dataKey="month" tick={{ fontSize: 11 }} />;
  const yAxis = <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />;
  const tooltip = <Tooltip formatter={(v: any) => formatAUD(Number(v))} />;
  const legend = <Legend wrapperStyle={{ fontSize: 11 }} />;

  if (type === 'lines') {
    return (
      <LineChart data={chartData}>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {catNames.map((c, i) => (
          <Line key={c} dataKey={c} stroke={CHART_COLORS[i % CHART_COLORS.length]} type="monotone" dot={false} />
        ))}
      </LineChart>
    );
  }
  if (type === 'area') {
    return (
      <AreaChart data={chartData}>
        {grid}{xAxis}{yAxis}{tooltip}{legend}
        {catNames.map((c, i) => (
          <Area key={c} dataKey={c} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} stroke={CHART_COLORS[i % CHART_COLORS.length]} />
        ))}
      </AreaChart>
    );
  }
  return (
    <BarChart data={chartData}>
      {grid}{xAxis}{yAxis}{tooltip}{legend}
      {catNames.map((c, i) => (
        <Bar key={c} dataKey={c} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
      ))}
    </BarChart>
  );
}