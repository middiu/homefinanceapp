import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, RefreshCw, Upload, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useGetPortfolioQuery, useListHoldingsQuery, useListAccountsQuery,
  useCreateHoldingMutation, useDeleteHoldingMutation, useImportHoldingsMutation, useRefreshPriceMutation,
} from '@/app/api';
import { PageHeader, EmptyState, StatCard } from '@/components/common';
import { formatAUD, formatDate, monthLabel, CHART_COLORS, pct, localISODate } from '@/lib/utils';

export default function InvestmentsPage() {
  const { data: accounts } = useListAccountsQuery();
  const [accountId, setAccountId] = useState('');
  const { data: portfolio, isLoading, refetch } = useGetPortfolioQuery(accountId ? { accountId } : undefined);
  const { data: holdings } = useListHoldingsQuery(accountId ? { accountId } : undefined);
  const [create] = useCreateHoldingMutation();
  const [del] = useDeleteHoldingMutation();
  const [importH] = useImportHoldingsMutation();
  const [refresh, { isLoading: refreshing }] = useRefreshPriceMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const invAccounts = (accounts ?? []).filter((a) => a.type === 'investment');

  const p = portfolio;

  return (
    <div>
      <PageHeader
        title="Investments"
        subtitle="Track ETF/share holdings via Yahoo Finance (20-min delayed)"
        actions={
          <>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-44">
              <option value="">All investment accounts</option>
              {invAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="h-4 w-4" /> Import CSV</Button>
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add holding</Button>
          </>
        }
      />

      {isLoading || !p ? <p className="text-muted-foreground">Loading portfolio…</p> : (
        <>
          {p.stale && <p className="mb-3 text-sm text-amber-500">Some prices are stale or unavailable — click Refresh per ticker.</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Total value" value={formatAUD(p.totalValue)} hint={p.stale ? 'partial' : undefined} />
            <StatCard label="Total cost" value={formatAUD(p.totalCost)} />
            <StatCard label="Total gain" value={formatAUD(p.totalGain)} tone={p.totalGain >= 0 ? 'positive' : 'negative'} />
            <StatCard label="Gain %" value={p.totalGainPct == null ? '—' : pct(p.totalGainPct)} tone={p.totalGain >= 0 ? 'positive' : 'negative'} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader><CardTitle>Allocation</CardTitle><CardDescription>By current value</CardDescription></CardHeader>
              <CardContent>
                {p.allocation.length === 0 ? <EmptyState message="No holdings" /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={p.allocation} dataKey="value" nameKey="ticker" innerRadius={50} outerRadius={90} paddingAngle={2}>
                        {p.allocation.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Portfolio trend</CardTitle><CardDescription>Value vs cost over time</CardDescription></CardHeader>
              <CardContent>
                {p.trend.length < 2 ? <EmptyState message="Not enough snapshots yet" /> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={p.trend.map((t: any) => ({ date: monthLabel(t.date.slice(0, 7)), Value: t.value, Cost: t.cost }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v: any) => formatAUD(Number(v))} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Area type="monotone" dataKey="Value" stroke="#10b981" fill="#10b98133" />
                      <Area type="monotone" dataKey="Cost" stroke="#6366f1" fill="#6366f133" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader><CardTitle>Holdings</CardTitle><CardDescription>Click a row to drill down into lots</CardDescription></CardHeader>
            <CardContent>
              {p.holdings.length === 0 ? <EmptyState message="No holdings. Add one or import a CSV." /> : (
                <div className="space-y-1">
                  <div className="hidden grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                    <span className="col-span-2">Ticker</span>
                    <span className="col-span-2 text-right">Qty</span>
                    <span className="col-span-2 text-right">Avg cost</span>
                    <span className="col-span-2 text-right">Price</span>
                    <span className="col-span-2 text-right">Value</span>
                    <span className="col-span-2 text-right">Gain</span>
                  </div>
                  {p.holdings.map((h: any) => {
                    const open = expanded === h.ticker;
                    return (
                      <div key={h.ticker}>
                        <button onClick={() => setExpanded(open ? null : h.ticker)} className="grid w-full grid-cols-12 items-center gap-2 rounded-md border border-border px-2 py-2 text-sm text-left hover:bg-muted/40">
                          <span className="col-span-2 flex items-center gap-1 font-medium">
                            {h.lots.length > 1 ? (open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />) : null}
                            {h.ticker}
                          </span>
                          <span className="col-span-2 text-right">{h.quantity}</span>
                          <span className="col-span-2 text-right">{formatAUD(h.avgCost)}</span>
                          <span className="col-span-2 text-right">{h.currentPrice != null ? formatAUD(h.currentPrice) : <Badge tone="warning">stale</Badge>}</span>
                          <span className="col-span-2 text-right">{h.value != null ? formatAUD(h.value) : '—'}</span>
                          <span className={`col-span-2 text-right ${h.gain == null ? '' : h.gain >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {h.gain != null ? `${formatAUD(h.gain)} (${pct(h.gainPct)})` : '—'}
                          </span>
                        </button>
                        {open && h.lots.length > 1 && (
                          <div className="ml-6 mb-1 space-y-1">
                            {h.lots.map((lot: any) => {
                              const lotRow = (holdings ?? []).find((x) => x.id === lot.id);
                              return (
                                <div key={lot.id} className="grid grid-cols-12 gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs">
                                  <span className="col-span-3 text-muted-foreground">{formatDate(lot.purchaseDate)}</span>
                                  <span className="col-span-2 text-right">{lot.quantity}</span>
                                  <span className="col-span-2 text-right">{formatAUD(lot.purchasePrice)}</span>
                                  <span className="col-span-3 text-right text-muted-foreground">{lotRow?.fees ? `fees ${formatAUD(lotRow.fees)}` : ''}</span>
                                  <span className="col-span-2 text-right">
                                    <button onClick={() => del(lot.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {open && h.lots.length === 1 && (
                          <div className="ml-6 mb-1 flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => refresh({ ticker: h.ticker })} disabled={refreshing}><RefreshCw className="h-3 w-3" /> Refresh price</Button>
                            <Button size="sm" variant="ghost" onClick={() => del(h.lots[0].id)}><Trash2 className="h-3 w-3" /> Delete</Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {showAdd && <AddHoldingDialog accounts={invAccounts} onClose={() => setShowAdd(false)} onCreate={async (b) => { await create(b); setShowAdd(false); }} />}
      {showImport && <ImportHoldingsDialog accounts={invAccounts} onClose={() => setShowImport(false)} onImport={async (fd) => { await importH(fd); setShowImport(false); refetch(); }} />}
    </div>
  );
}

function AddHoldingDialog({ accounts, onClose, onCreate }: { accounts: any[]; onClose: () => void; onCreate: (b: any) => void }) {
  const [form, setForm] = useState({ accountId: accounts[0]?.id ?? '', ticker: '', purchaseDate: localISODate(), quantity: '', purchasePrice: '', fees: '' });
  const valid = form.accountId && form.ticker && form.quantity && form.purchasePrice;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Add holding</h2>
        <div className="space-y-3">
          <Select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Select investment account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input placeholder="Ticker (e.g. VAS.AX)" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} />
          <Input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" step="0.0001" placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            <Input type="number" step="0.01" placeholder="Purchase price" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} />
          </div>
          <Input type="number" step="0.01" placeholder="Fees / brokerage (optional)" value={form.fees} onChange={(e) => setForm({ ...form, fees: e.target.value })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onCreate({ ...form, quantity: Number(form.quantity), purchasePrice: Number(form.purchasePrice), fees: form.fees ? Number(form.fees) : null })}>Add</Button>
        </div>
      </div>
    </div>
  );
}

function ImportHoldingsDialog({ accounts, onClose, onImport }: { accounts: any[]; onClose: () => void; onImport: (fd: FormData) => void }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [columnMap, setColumnMap] = useState({ ticker: 'ticker', purchase_date: 'date', quantity: 'quantity', price: 'price', fees: 'fees' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">Import holdings CSV</h2>
        <p className="mb-3 text-xs text-muted-foreground">Columns expected: ticker, date, quantity, price, fees. Header row required. We auto-detect common column names.</p>
        <div className="space-y-3">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Select investment account…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!accountId || !file} onClick={() => {
            const fd = new FormData();
            fd.append('file', file!);
            fd.append('accountId', accountId);
            fd.append('columnMap', JSON.stringify(columnMap));
            onImport(fd);
          }}><Upload className="h-4 w-4" /> Import</Button>
        </div>
      </div>
    </div>
  );
}