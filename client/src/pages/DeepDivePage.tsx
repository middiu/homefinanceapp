import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, XAxis, YAxis, CartesianGrid, BarChart, Bar } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Sparkles } from 'lucide-react';
import { useGetDeepDiveQuery, useListMembersQuery, useListAccountsQuery, useGenerateForecastMutation, useListSubscriptionsQuery, useListAnomaliesQuery, useUpdateTransactionMutation } from '@/app/api';
import { PageHeader, EmptyState, Money, DeltaBadge } from '@/components/common';
import { CategorySelect } from '@/components/CategorySelect';
import { JobProgressModal } from '@/components/JobProgressModal';
import { formatAUD, formatDate, monthLabel, CHART_COLORS } from '@/lib/utils';

export default function DeepDivePage() {
  const [params, setParams] = useSearchParams();
  const scopeType = params.get('memberId') ? 'member' : params.get('accountId') ? 'account' : 'member';
  const [scopeId, setScopeId] = useState(params.get('memberId') || params.get('accountId') || '');
  const { data: members } = useListMembersQuery();
  const { data: accounts } = useListAccountsQuery();
  const query: any = scopeType === 'member' ? { memberId: scopeId } : { accountId: scopeId };
  const { data, isLoading } = useGetDeepDiveQuery(query, { skip: !scopeId });
  const [generateForecast] = useGenerateForecastMutation();
  const [forecast, setForecast] = useState<any>(null);
  const [forecastJobId, setForecastJobId] = useState<string | null>(null);

  async function startForecast() {
    try {
      const r: any = await generateForecast(query);
      setForecastJobId(r.data?.jobId ?? null);
    } catch {
      /* surfaced via modal */
    }
  }
  const { data: subs } = useListSubscriptionsQuery(scopeType === 'account' ? { accountId: scopeId } : {});
  const { data: anomalies } = useListAnomaliesQuery(scopeType === 'account' ? { accountId: scopeId } : {});
  const [updateTx] = useUpdateTransactionMutation();

  function setScope(type: 'member' | 'account', id: string) {
    setScopeId(id);
    const next = new URLSearchParams();
    if (id) next.set(type === 'member' ? 'memberId' : 'accountId', id);
    setParams(next);
  }

  return (
    <div>
      <PageHeader
        title="Person / Account Deep-Dive"
        subtitle="Ownership-weighted breakdown for a single member or account"
        actions={
          <>
            <Select value={scopeType} onChange={(e) => setScope(e.target.value as any, '')} className="w-32">
              <option value="member">Member</option>
              <option value="account">Account</option>
            </Select>
            <Select value={scopeId} onChange={(e) => setScope(scopeType, e.target.value)} className="w-48">
              <option value="">Select…</option>
              {scopeType === 'member'
                ? members?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)
                : accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={startForecast}>
              <Sparkles className="h-4 w-4" /> Forecast
            </Button>
          </>
        }
      />

      {!scopeId ? <EmptyState message="Select a member or account to begin." /> :
        isLoading || !data ? <div className="text-muted-foreground">Loading…</div> : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Current spend</div><div className="mt-1 text-2xl font-bold">{formatAUD(data.currentSpend)}</div></Card>
              <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Previous spend</div><div className="mt-1 text-2xl font-bold">{formatAUD(data.previousSpend)}</div></Card>
              <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Categories</div><div className="mt-1 text-2xl font-bold">{data.spendByCategory.length}</div></Card>
              <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Net worth trend</div><div className="mt-1 text-2xl font-bold">{formatAUD(data.netWorthTrend.at(-1)?.value ?? 0)}</div></Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Personal net worth trend</CardTitle><CardDescription>Trailing 12 months</CardDescription></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={data.netWorthTrend.map((m: any) => ({ month: monthLabel(m.month), value: m.value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Line dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Spend by category</CardTitle><CardDescription>This period</CardDescription></CardHeader>
                <CardContent>
                  {data.spendByCategory.length === 0 ? <EmptyState message="No spend" /> : (
                    <ResponsiveContainer width="100%" height={260}>
                      <PieChart>
                        <Pie data={data.spendByCategory} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2}>
                          {data.spendByCategory.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Category comparison</CardTitle><CardDescription>This period vs previous</CardDescription></CardHeader>
                <CardContent>
                  {data.categoryComparison.length === 0 ? <EmptyState message="No data" /> : (
                    <div className="space-y-1">
                      {data.categoryComparison.map((c: any) => (
                        <div key={c.name} className="flex items-center gap-2 py-1 text-sm">
                          <span className="flex-1 truncate">{c.name}</span>
                          <span className="w-20 text-right">{formatAUD(c.current)}</span>
                          <span className="w-20 text-right text-muted-foreground">{formatAUD(c.previous)}</span>
                          <DeltaBadge delta={c.deltaPct} />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Cash-flow forecast</CardTitle><CardDescription>Statistical projection · AI narrative</CardDescription></CardHeader>
                <CardContent>
                  {forecast ? (
                    <div className="space-y-3">
                      <ResponsiveContainer width="100%" height={160}>
                        <BarChart data={forecast.projection.map((m: any) => ({ month: monthLabel(m.month), projected: m.projected }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                          <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                          <Bar dataKey="projected" fill="#8b5cf6" />
                        </BarChart>
                      </ResponsiveContainer>
                      <p className="text-xs text-muted-foreground">⚠ AI-generated, advisory only</p>
                      <p className="text-sm">{forecast.content}</p>
                    </div>
                  ) : (
                    <EmptyState message="Click Forecast to generate a 3-month projection." icon={<Sparkles className="h-6 w-6" />} />
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Subscriptions & recurring</CardTitle><CardDescription>Detected recurring charges</CardDescription></CardHeader>
                <CardContent>
                  {(subs as any[])?.length ? (subs as any[]).map((s, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                      <div><div className="font-medium">{s.description}</div><div className="text-xs text-muted-foreground">every ~{Math.round((new Date(s.nextDate).getTime() - new Date(s.lastDate).getTime()) / 86400000)}d · {s.count}x</div></div>
                      <div className="text-right"><Money amount={-s.amount} /><div className="text-xs text-muted-foreground">next {formatDate(s.nextDate)}</div></div>
                    </div>
                  )) : <EmptyState message="No recurring charges detected" />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>Anomalies</CardTitle><CardDescription>Unusual transactions to review</CardDescription></CardHeader>
                <CardContent>
                  {(anomalies as any[])?.length ? (anomalies as any[]).map((a) => (
                    <div key={a.id} className="flex items-center gap-2 border-b border-border py-2 text-sm last:border-0">
                      <div className="flex-1">
                        <div className="truncate font-medium">{a.description}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(a.date)} · {a.reason}</div>
                      </div>
                      <CategorySelect value={a.categoryId} onChange={(id) => updateTx({ id: a.id, body: { categoryId: id, source: 'manual' } })} className="w-40" />
                      <span className="w-24 text-right"><Money amount={a.amount} /></span>
                    </div>
                  )) : <EmptyState message="No anomalies detected" />}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      <JobProgressModal
        jobId={forecastJobId}
        title="Generating forecast"
        onDone={(result) => setForecast(result)}
        onClose={() => setForecastJobId(null)}
      />
    </div>
  );
}