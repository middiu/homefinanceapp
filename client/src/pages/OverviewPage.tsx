import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, Legend, CartesianGrid, Line, ComposedChart, Area } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetOverviewQuery, useGenerateInsightMutation, useListAccountsQuery, useListMembersQuery, useUpdateTransactionMutation } from '@/app/api';
import { PageHeader, StatCard, EmptyState, Money, DeltaBadge } from '@/components/common';
import { CategorySelect } from '@/components/CategorySelect';
import { formatAUD, formatDate, monthLabel, CHART_COLORS, pct } from '@/lib/utils';

export default function OverviewPage() {
  const [range, setRange] = useState('current');
  const navigate = useNavigate();
  const { data, isLoading } = useGetOverviewQuery({});
  const { data: accounts } = useListAccountsQuery();
  const { data: members } = useListMembersQuery();
  const [generateInsight] = useGenerateInsightMutation();
  const [updateTx] = useUpdateTransactionMutation();

  if (isLoading || !data) return <div className="text-muted-foreground">Loading dashboard…</div>;

  const s = data.summary;
  const pie = data.spendingByCategory;
  const catTrend = data.categoryTrend;
  const ivs = data.incomeVsExpense;

  // collect category names for stacked bar
  const catNames = Array.from(new Set(catTrend.flatMap((m: any) => Object.keys(m.categories) as string[]))) as string[];

  return (
    <div>
      <PageHeader
        title="Household Overview"
        subtitle={`Period ${formatDate(s.period.from)} – ${formatDate(s.period.to)}`}
        actions={
          <>
            <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-36">
              <option value="current">This month</option>
              <option value="3">3 months</option>
              <option value="6">6 months</option>
              <option value="12">12 months</option>
              <option value="ytd">YTD</option>
            </Select>
            <Button variant="outline" size="sm" onClick={() => generateInsight({ scope: 'household' })}>
              <Sparkles className="h-4 w-4" /> New insight
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total balance" value={formatAUD(s.totalBalance)} />
        <StatCard label="Spend this month" value={formatAUD(s.currentSpend)} delta={s.spendDeltaPct} />
        <StatCard label="Income this month" value={formatAUD(s.currentIncome)} delta={s.incomeDeltaPct} />
        <StatCard label="Net cash flow" value={formatAUD(s.netCashFlow)} tone={s.netCashFlow >= 0 ? 'positive' : 'negative'} />
        <StatCard label="Last month spend" value={formatAUD(s.previousSpend)} />
        <StatCard label="Accounts" value={String(accounts?.length ?? 0)} hint={`${members?.length ?? 0} members`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Spending by category</CardTitle><CardDescription>This month</CardDescription></CardHeader>
          <CardContent>
            {pie.length === 0 ? <EmptyState message="No spending yet" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                    {pie.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Income vs expense</CardTitle><CardDescription>Trailing 12 months</CardDescription></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={ivs.map((m: any) => ({ month: monthLabel(m.month), Income: m.income, Expense: m.expense }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Income" fill="#10b981" />
                <Bar dataKey="Expense" fill="#ef4444" />
                <Line dataKey="Income" stroke="#10b981" type="monotone" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Category trends</CardTitle><CardDescription>Trailing 6 months (stacked)</CardDescription></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={catTrend.map((m: any) => ({ month: monthLabel(m.month), ...m.categories }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {catNames.map((c: string, i: number) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>AI insight</CardTitle><CardDescription>AI-generated · advisory</CardDescription></CardHeader>
          <CardContent>
            {data.latestInsight ? (
              <div className="space-y-2">
                <p className="text-sm">{data.latestInsight.content}</p>
                <p className="text-xs text-muted-foreground">{new Date(data.latestInsight.generatedAt).toLocaleString('en-AU')}</p>
              </div>
            ) : (
              <EmptyState message="No insight yet. Click “New insight”." icon={<Sparkles className="h-6 w-6" />} />
            )}
            <Button variant="outline" size="sm" className="mt-3" onClick={() => generateInsight({ scope: 'household' })}>
              <Sparkles className="h-4 w-4" /> Generate
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Account balances</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/accounts')}>Manage</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(data.accountsByType).length === 0 ? <EmptyState message="No accounts. Add one in Accounts & Members." /> :
              Object.entries(data.accountsByType).map(([type, list]) => (
                <div key={type}>
                  <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">{type}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(list as any[]).map((a) => (
                      <div key={a.id} className="flex items-center justify-between rounded-md border border-border p-2">
                        <div>
                          <div className="text-sm font-medium">{a.name}</div>
                          <Sparkline data={a.spark} />
                        </div>
                        <Money amount={a.balance} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Per person</CardTitle><CardDescription>Net-worth share & spend</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {(data.perPerson as any[]).length === 0 ? <EmptyState message="Add household members" /> :
              (data.perPerson as any[]).map((p) => (
                <button
                  key={p.memberId}
                  onClick={() => navigate(`/deepdive?memberId=${p.memberId}`)}
                  className="flex w-full items-center justify-between rounded-md border border-border p-3 text-left hover:bg-muted/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                    <span className="text-sm font-medium">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatAUD(p.netWorth)}</div>
                    <div className="text-xs text-muted-foreground">spent {formatAUD(p.spend)}</div>
                  </div>
                </button>
              ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Recent transactions</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/transactions')}>View all <ArrowRight className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent>
          {(data.recent as any[]).length === 0 ? <EmptyState message="No transactions yet — import a bank export." /> : (
            <div className="space-y-1">
              {(data.recent as any[]).map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md py-1.5 text-sm">
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{formatDate(t.date)}</span>
                  <span className="w-28 shrink-0 truncate text-muted-foreground">{t.accountName}</span>
                  <span className="flex-1 truncate">{t.description}</span>
                  <CategorySelect
                    value={t.categoryId}
                    onChange={(id) => updateTx({ id: t.id, body: { categoryId: id, source: 'manual' } })}
                  />
                  <span className="w-24 text-right"><Money amount={t.amount} signed /></span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${30 - ((v - min) / range) * 30}`).join(' ');
  return (
    <svg width="100" height="30" className="mt-0.5 opacity-70">
      <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth="1.5" />
    </svg>
  );
}