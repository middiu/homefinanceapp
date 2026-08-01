import { useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { useGenerateForecastReportMutation } from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';
import { formatAUD, monthLabel } from '@/lib/utils';

export default function ReportForecastPage() {
  const [report, setReport] = useState<any>(null);
  const [gen, { isLoading }] = useGenerateForecastReportMutation();
  const [err, setErr] = useState('');

  async function generate() {
    setErr('');
    try {
      const r: any = await gen({});
      if (r.error) setErr(r.error);
      else setReport(r.data);
    } catch (e: any) { setErr(e?.data?.error ?? e?.message ?? 'forecast failed'); }
  }

  const chart = report ? [...report.history.map((h: any) => ({ month: monthLabel(h.month), actual: h.net, forecast: null, income: h.income, expense: h.expense })), ...report.forecast.map((f: any) => ({ month: monthLabel(f.month), actual: null, forecast: f.net, cumulative: f.cumulative }))] : [];

  return (
    <div>
      <PageHeader
        title="12-Month Forecast"
        subtitle="AI-projected cash flow from your transaction history & recurring patterns"
        actions={<Button size="sm" onClick={generate} disabled={isLoading}><Sparkles className="h-4 w-4" /> {isLoading ? 'Generating…' : 'Generate forecast'}</Button>}
      />

      {err && <p className="mb-3 text-sm text-red-400"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{err}</p>}

      {!report && !isLoading && <EmptyState message="Click Generate to produce a 12-month forecast. Requires AI enabled in AI & Insights." icon={<Sparkles className="h-6 w-6" />} />}

      {isLoading && !report && <p className="text-muted-foreground">Generating forecast…</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Projected net (12mo)</div><div className="mt-1 text-2xl font-bold">{formatAUD(report.forecast.reduce((s: number, f: any) => s + f.net, 0))}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">End balance (proj)</div><div className="mt-1 text-2xl font-bold">{formatAUD(report.forecast.at(-1)?.cumulative ?? 0)}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Avg monthly income</div><div className="mt-1 text-2xl font-bold text-emerald-400">{formatAUD(report.forecast.reduce((s: number, f: any) => s + f.income, 0) / Math.max(1, report.forecast.length))}</div></Card>
            <Card className="p-4"><div className="text-xs uppercase text-muted-foreground">Avg monthly expense</div><div className="mt-1 text-2xl font-bold text-red-400">{formatAUD(report.forecast.reduce((s: number, f: any) => s + f.expense, 0) / Math.max(1, report.forecast.length))}</div></Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Actuals & forecast</CardTitle><CardDescription>Net cash flow — solid = actual, dashed = projected, line = cumulative</CardDescription></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: any) => (v == null ? '—' : formatAUD(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="actual" name="Actual net" fill="#3b82f6" />
                  <Bar dataKey="forecast" name="Forecast net" fill="#f59e0b" />
                  <Line dataKey="cumulative" name="Cumulative" stroke="#8b5cf6" type="monotone" dot={false} strokeDasharray="5 5" />
                  <ReferenceLine y={0} stroke="#666" />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Month-by-month</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {report.forecast.map((f: any) => (
                    <div key={f.month} className="grid grid-cols-5 items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
                      <span className="col-span-1">{monthLabel(f.month)}</span>
                      <span className="col-span-1 text-right text-emerald-400">{formatAUD(f.income)}</span>
                      <span className="col-span-1 text-right text-red-400">{formatAUD(f.expense)}</span>
                      <span className={`col-span-1 text-right ${f.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{formatAUD(f.net)}</span>
                      <span className="col-span-1 text-right text-muted-foreground">{formatAUD(f.cumulative)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Recurring detected</CardTitle><CardDescription>Subscriptions & repeat expenses</CardDescription></CardHeader>
              <CardContent>
                {report.recurring.length === 0 ? <EmptyState message="No recurring detected" /> : (
                  <div className="space-y-1">
                    {report.recurring.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-border px-2 py-1.5 text-sm">
                        <span className="truncate" title={r.description}>{r.description}</span>
                        <span className="text-red-400">{formatAUD(r.monthly)}/mo</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>AI narrative</CardTitle><CardDescription>Plain-language summary · advisory only</CardDescription></CardHeader>
            <CardContent><p className="whitespace-pre-line text-sm">{report.narrative}</p></CardContent>
          </Card>
        </>
      )}
    </div>
  );
}