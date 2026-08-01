import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Repeat, ArrowDownWideNarrow } from 'lucide-react';
import { useListSubscriptionsQuery, useListAnomaliesQuery, useListTransactionsQuery, useListAccountsQuery, useListCategoriesQuery } from '@/app/api';
import { PageHeader, EmptyState, Money } from '@/components/common';
import { formatAUD, formatDate } from '@/lib/utils';

function monthStart(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
function monthEnd(d = new Date()) { const e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`; }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }

export default function InsightsPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState('last12');
  const { data: accounts = [] } = useListAccountsQuery();
  const { data: categories = [] } = useListCategoriesQuery();
  const { data: subscriptions, isLoading: subsLoading } = useListSubscriptionsQuery({});
  const { data: anomalies, isLoading: anomLoading } = useListAnomaliesQuery({});
  const { data: largest } = useListTransactionsQuery(txFilter(range));

  const accountName = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  return (
    <div>
      <PageHeader title="Insights" subtitle="Recurring subscriptions, spending anomalies, and largest transactions" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle className="flex items-center gap-2"><Repeat className="h-4 w-4" /> Recurring subscriptions</CardTitle><CardDescription>Detected recurring debits</CardDescription></div>
          </CardHeader>
          <CardContent>
            {subsLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
              !subscriptions || subscriptions.length === 0 ? (
                <EmptyState message="No recurring subscriptions detected. Ensure AI is enabled and transactions are imported." icon={<Repeat className="h-6 w-6" />} />
              ) : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-5">Description</span>
                    <span className="col-span-2 text-right">Amount</span>
                    <span className="col-span-2 text-right">Count</span>
                    <span className="col-span-3 text-right">Last → next</span>
                  </div>
                  {subscriptions.map((s, i) => (
                    <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                      <span className="col-span-5 truncate">{s.description}</span>
                      <span className="col-span-2 text-right text-red-400">{formatAUD(s.amount)}</span>
                      <span className="col-span-2 text-right text-muted-foreground">{s.count}</span>
                      <span className="col-span-3 truncate text-right text-xs text-muted-foreground">
                        {formatDate(s.lastDate)}{s.nextDate ? ` → ${formatDate(s.nextDate)}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Anomalies</CardTitle><CardDescription>Unusually large or atypical transactions</CardDescription></div>
          </CardHeader>
          <CardContent>
            {anomLoading ? <p className="text-sm text-muted-foreground">Loading…</p> :
              !anomalies || anomalies.length === 0 ? (
                <EmptyState message="No anomalies detected. Ensure AI is enabled." icon={<AlertTriangle className="h-6 w-6" />} />
              ) : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-2">Date</span>
                    <span className="col-span-5">Description</span>
                    <span className="col-span-2 text-right">Amount</span>
                    <span className="col-span-3 text-right">Reason</span>
                  </div>
                  {anomalies.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => navigate(`/transactions?search=${encodeURIComponent(a.description)}`)}
                      className="grid w-full grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="col-span-2 text-xs text-muted-foreground">{formatDate(a.date)}</span>
                      <span className="col-span-5 truncate">{a.description}</span>
                      <span className="col-span-2 text-right text-red-400">{formatAUD(a.amount)}</span>
                      <span className="col-span-3 truncate text-right text-xs text-muted-foreground">{a.reason}</span>
                    </button>
                  ))}
                </div>
              )
            }
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle className="flex items-center gap-2"><ArrowDownWideNarrow className="h-4 w-4" /> Largest transactions</CardTitle><CardDescription>Biggest expenses in range</CardDescription></div>
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
            <option value="thisMonth">This month</option>
            <option value="lastMonth">Last month</option>
            <option value="ytd">Year to date</option>
            <option value="last12">Last 12 months</option>
            <option value="all">All time</option>
          </Select>
        </CardHeader>
        <CardContent>
          {!largest || largest.items.length === 0 ? <EmptyState message="No expenses in range" /> : (
            <div className="space-y-1">
              <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                <span className="col-span-2">Date</span>
                <span className="col-span-2">Account</span>
                <span className="col-span-4">Description</span>
                <span className="col-span-2">Category</span>
                <span className="col-span-2 text-right">Amount</span>
              </div>
              {largest.items.map((t) => (
                <button
                  key={t.id}
                  onClick={() => navigate('/transactions')}
                  className="grid w-full grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-left text-sm hover:bg-muted/40"
                >
                  <span className="col-span-2 text-xs text-muted-foreground">{formatDate(t.date)}</span>
                  <span className="col-span-2 truncate text-muted-foreground">{accountName.get(t.accountId) || '—'}</span>
                  <span className="col-span-4 truncate">{t.description}</span>
                  <span className="col-span-2 truncate">
                    {t.categoryId ? <Badge tone="muted">{categoryName.get(t.categoryId) || '—'}</Badge> : <span className="text-muted-foreground">—</span>}
                  </span>
                  <span className="col-span-2 text-right"><Money amount={t.amount} signed /></span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function txFilter(range: string) {
  const now = new Date();
  if (range === 'all') return { sort: 'amount:asc', amountMax: 0, pageSize: 20 };
  if (range === 'thisMonth') return { sort: 'amount:asc', amountMax: 0, pageSize: 20, dateFrom: monthStart(now), dateTo: monthEnd(now) };
  if (range === 'lastMonth') { const lm = addMonths(now, -1); return { sort: 'amount:asc', amountMax: 0, pageSize: 20, dateFrom: monthStart(lm), dateTo: monthEnd(lm) }; }
  if (range === 'ytd') return { sort: 'amount:asc', amountMax: 0, pageSize: 20, dateFrom: `${now.getFullYear()}-01-01`, dateTo: monthEnd(now) };
  // last12
  return { sort: 'amount:asc', amountMax: 0, pageSize: 20, dateFrom: monthStart(addMonths(now, -11)), dateTo: monthEnd(now) };
}