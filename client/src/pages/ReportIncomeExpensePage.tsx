import { useState } from 'react';
import { ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Download } from 'lucide-react';
import { useGetIncomeExpenseReportQuery, useListAccountsQuery, useListMembersQuery } from '@/app/api';
import { PageHeader, EmptyState, Money, DeltaBadge } from '@/components/common';
import { formatAUD, formatDate, monthLabel, pct } from '@/lib/utils';

export default function ReportIncomeExpensePage() {
  const { data: accounts } = useListAccountsQuery();
  const { data: members } = useListMembersQuery();
  const [preset, setPreset] = useState('last12');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [accountId, setAccountId] = useState('');
  const [memberId, setMemberId] = useState('');

  const params = preset === 'custom'
    ? { preset, dateFrom, dateTo, accountId: accountId || undefined, memberId: memberId || undefined }
    : { preset, accountId: accountId || undefined, memberId: memberId || undefined };
  const { data, isLoading } = useGetIncomeExpenseReportQuery(params as any);
  const savingsRate = data && data.totals.income > 0 ? Math.round((data.totals.net / data.totals.income) * 1000) / 10 : null;

  function exportCsv() {
    if (!data) return;
    const header = ['Category', 'Type', 'Income', 'Expense', 'Net', 'Prev income', 'Prev expense', 'Δ%'];
    const lines = data.rows.map((r) => [r.name, r.type ?? '', r.income, r.expense, r.net, r.prevIncome, r.prevExpense, r.deltaPct ?? ''].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `income-expense-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Income vs Expense by Category"
        subtitle="Compare categories against the previous period"
        actions={<Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}><Download className="h-4 w-4" /> Export CSV</Button>}
      />

      <div className="mb-3 flex flex-wrap gap-2">
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
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-40">
          <option value="">All accounts</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={memberId} onChange={(e) => setMemberId(e.target.value)} className="w-40">
          <option value="">All members</option>
          {members?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </div>

      {isLoading || !data ? <p className="text-muted-foreground">Loading report…</p> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>Period {formatDate(data.period.from)} – {formatDate(data.period.to)}</span>
            <span>·</span>
            <span>Prev {formatDate(data.period.prevFrom)} – {formatDate(data.period.prevTo)}</span>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Income</div><div className="mt-1 text-2xl font-bold text-emerald-400">{formatAUD(data.totals.income)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Expense</div><div className="mt-1 text-2xl font-bold text-red-400">{formatAUD(data.totals.expense)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Net</div><div className={`mt-1 text-2xl font-bold ${data.totals.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatAUD(data.totals.net)}</div></Card>
            <Card className="p-4">
              <div className="text-xs uppercase text-muted-foreground">Savings rate</div>
              <div className={`mt-1 text-2xl font-bold ${savingsRate != null && savingsRate >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {savingsRate == null ? '—' : pct(savingsRate)}
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Monthly trend</CardTitle><CardDescription>Income vs expense over the report span</CardDescription></CardHeader>
            <CardContent>
              {data.monthly.length === 0 ? <EmptyState message="No data in period" /> : (
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={data.monthly.map((m) => ({ month: monthLabel(m.month), Income: m.income, Expense: m.expense, Net: m.income - m.expense }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Income" fill="#10b981" />
                    <Bar dataKey="Expense" fill="#ef4444" />
                    <Line dataKey="Net" stroke="#3b82f6" type="monotone" dot={false} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader><CardTitle>Savings rate over time</CardTitle><CardDescription>Monthly (income − expense) ÷ income</CardDescription></CardHeader>
            <CardContent>
              {data.monthly.length === 0 ? <EmptyState message="No data in period" /> : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={data.monthly.map((m) => ({ month: monthLabel(m.month), rate: m.income > 0 ? Math.round(((m.income - m.expense) / m.income) * 1000) / 10 : null }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: any) => (v == null ? '—' : `${Number(v)}%`)} />
                    <Line dataKey="rate" stroke="#10b981" type="monotone" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader><CardTitle>By category</CardTitle><CardDescription>Net vs previous period</CardDescription></CardHeader>
            <CardContent>
              {data.rows.length === 0 ? <EmptyState message="No transactions in period" /> : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-4">Category</span>
                    <span className="col-span-2 text-right">Income</span>
                    <span className="col-span-2 text-right">Expense</span>
                    <span className="col-span-2 text-right">Net</span>
                    <span className="col-span-2 text-right">Δ vs prev</span>
                  </div>
                  {data.rows.map((r) => (
                    <div key={r.categoryId} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                      <span className="col-span-4 flex items-center gap-2">
                        {r.name}
                        {r.type && <Badge tone="muted">{r.type}</Badge>}
                      </span>
                      <span className="col-span-2 text-right text-emerald-400">{formatAUD(r.income)}</span>
                      <span className="col-span-2 text-right text-red-400">{formatAUD(r.expense)}</span>
                      <span className={`col-span-2 text-right ${r.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatAUD(r.net)}</span>
                      <span className="col-span-2 text-right"><DeltaBadge delta={r.deltaPct} /></span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}