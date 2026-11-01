import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Download, Plus, Trash2, CheckCheck, Unlink, Sparkles, AlertTriangle } from 'lucide-react';
import {
  useListTransactionsQuery,
  useListAccountsQuery,
  useListCategoriesQuery,
  useListMembersQuery,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useBulkCategorizeMutation,
  useRecategorizeMutation,
  useDeleteAllTransactionsMutation,
  useMarkReviewedMutation,
  useUnlinkTransferMutation,
  useCreateTransactionMutation,
  useAiStatusQuery,
  api,
} from '@/app/api';
import { useDispatch } from 'react-redux';
import { PageHeader, EmptyState, Money } from '@/components/common';
import { CategorySelect, SourceBadge } from '@/components/CategorySelect';
import { JobProgressModal } from '@/components/JobProgressModal';
import { Badge } from '@/components/ui/badge';
import { formatAUD, formatDate, localISODate, apiErrorMessage } from '@/lib/utils';

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: PAGE_SIZE, sort: 'date:desc' });
  const [draft, setDraft] = useState<any>({ page: 1, pageSize: PAGE_SIZE, sort: 'date:desc' });
  const [searchParams, setSearchParams] = useSearchParams();
  // Hydrate filters from URL (drill-down links from Category analytics etc.).
  useEffect(() => {
    const s = new URLSearchParams(searchParams);
    if ([...s.keys()].length === 0) return;
    const next: any = { page: 1, pageSize: PAGE_SIZE, sort: 'date:desc' };
    if (s.get('search')) next.search = s.get('search')!;
    if (s.get('dateFrom')) next.dateFrom = s.get('dateFrom')!;
    if (s.get('dateTo')) next.dateTo = s.get('dateTo')!;
    const cat = s.get('categoryId');
    if (cat) next.categoryId = cat.split(',').filter(Boolean);
    const acc = s.get('accountId');
    if (acc) next.accountId = [acc];
    const mem = s.get('memberId');
    if (mem) next.memberId = [mem];
    setFilters(next);
    setDraft(next);
  }, [searchParams]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [recatOpen, setRecatOpen] = useState(false);
  const [recatScope, setRecatScope] = useState<'selected' | 'all'>('selected');
  const [recatWeb, setRecatWeb] = useState(true);
  const [recatJobId, setRecatJobId] = useState<string | null>(null);
  const [delAllOpen, setDelAllOpen] = useState(false);
  const [delAllText, setDelAllText] = useState('');
  const dispatch = useDispatch();

  const { data: accounts } = useListAccountsQuery();
  const { data: categories } = useListCategoriesQuery();
  const catTypeById = useMemo(() => new Map((categories ?? []).map((c) => [c.id, c.type])), [categories]);
  const { data: members } = useListMembersQuery();
  const { data, isLoading, isError, error } = useListTransactionsQuery(filters);
  const { data: aiStatus } = useAiStatusQuery();
  const [updateTx] = useUpdateTransactionMutation();
  const [deleteTx] = useDeleteTransactionMutation();
  const [bulk] = useBulkCategorizeMutation();
  const [recategorize] = useRecategorizeMutation();
  const [deleteAll] = useDeleteAllTransactionsMutation();
  const [markReviewed] = useMarkReviewedMutation();
  const [unlink] = useUnlinkTransferMutation();
  const [createTx] = useCreateTransactionMutation();

  async function startRecategorize() {
    const ids = recatScope === 'selected' ? [...selected] : undefined;
    setRecatOpen(false);
    try {
      const r: any = await recategorize({ ids, useWebSearch: recatWeb });
      setRecatJobId(r.data?.jobId ?? null);
    } catch {
      /* surfaced via modal */
    }
  }

  async function doDeleteAll() {
    try {
      await deleteAll();
      setDelAllOpen(false);
      setDelAllText('');
      setSelected(new Set());
    } catch {
      /* keep dialog open on error */
    }
  }

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setDraftField<K extends string>(key: K, value: any) {
    setDraft((d: any) => ({ ...d, [key]: value }));
  }
  function applyFilters() {
    setFilters({ ...draft, page: 1 });
  }
  function clearFilters() {
    const d = { page: 1, pageSize: PAGE_SIZE, sort: 'date:desc' };
    setDraft(d);
    setFilters({ ...d });
    if ([...searchParams.keys()].length) setSearchParams({}, { replace: true });
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r: any) => r.id))));
  }

  function exportCsv() {
    const header = ['Date', 'Account', 'Description', 'Amount', 'Category', 'Source'];
    const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
    const acctName = new Map((accounts ?? []).map((a) => [a.id, a.name]));
    const lines = rows.map((t: any) =>
      [t.date, acctName.get(t.accountId) || '', `"${t.description.replace(/"/g, '""')}"`, t.amount, catName.get(t.categoryId) || '', t.source].join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle={`${total} transaction${total === 1 ? '' : 's'}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => { setRecatScope(selected.size > 0 ? 'selected' : 'all'); setRecatOpen(true); }}><Sparkles className="h-4 w-4" /> Re-categorize</Button>
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-500" onClick={() => setDelAllOpen(true)}><Trash2 className="h-4 w-4" /> Delete all</Button>
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add</Button>
          </>
        }
      />

      {/* Filter bar — edit then click Apply (or press Enter in search) to run */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search description…"
          value={draft.search ?? ''}
          onChange={(e) => setDraftField('search', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
          className="w-48"
        />
        <Select value={draft.accountId?.[0] ?? ''} onChange={(e) => setDraftField('accountId', e.target.value ? [e.target.value] : undefined)} className="w-44">
          <option value="">All accounts</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={draft.categoryId?.[0] ?? ''} onChange={(e) => setDraftField('categoryId', e.target.value ? [e.target.value] : undefined)} className="w-44">
          <option value="">All categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={draft.memberId?.[0] ?? ''} onChange={(e) => setDraftField('memberId', e.target.value ? [e.target.value] : undefined)} className="w-40">
          <option value="">All members</option>
          {members?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Select value={String(draft.needsReview ?? '')} onChange={(e) => setDraftField('needsReview', e.target.value === '' ? undefined : e.target.value === 'true')} className="w-40">
          <option value="">All statuses</option>
          <option value="true">Needs review</option>
          <option value="false">Reviewed only</option>
        </Select>
        <Input type="date" value={draft.dateFrom ?? ''} onChange={(e) => setDraftField('dateFrom', e.target.value || undefined)} className="w-40" />
        <Input type="date" value={draft.dateTo ?? ''} onChange={(e) => setDraftField('dateTo', e.target.value || undefined)} className="w-40" />
        <Select value={draft.sort ?? 'date:desc'} onChange={(e) => setDraftField('sort', e.target.value)} className="w-40">
          <option value="date:desc">Date ↓</option>
          <option value="date:asc">Date ↑</option>
          <option value="amount:desc">Amount ↓</option>
          <option value="amount:asc">Amount ↑</option>
        </Select>
        <Button size="sm" onClick={applyFilters}>Apply</Button>
        <Button size="sm" variant="ghost" onClick={clearFilters}>Clear</Button>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <CategorySelect value={bulkCat} onChange={setBulkCat} className="w-44" />
          <Button size="sm" onClick={async () => { await bulk({ ids: [...selected], categoryId: bulkCat, source: 'manual' }); setSelected(new Set()); }}>Apply category</Button>
          <Button size="sm" variant="outline" onClick={async () => { await markReviewed({ ids: [...selected] }); setSelected(new Set()); }}><CheckCheck className="h-4 w-4" /> Mark reviewed</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Table className="table-fixed !text-xs">
        <THead>
          <TR>
            <TH className="w-8"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></TH>
            <TH className="w-20">Date</TH>
            <TH className="w-28 truncate">Account</TH>
            <TH className="w-72">Description</TH>
            <TH className="w-44">Category</TH>
            <TH className="w-16">Src</TH>
            <TH className="w-24 text-right">Amount</TH>
            <TH className="w-10"></TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TR><TD colSpan={8}><div className="py-8 text-center text-muted-foreground">Loading…</div></TD></TR>
          ) : isError ? (
            <TR><TD colSpan={8}><EmptyState message={apiErrorMessage(error, 'Could not load transactions')} /></TD></TR>
          ) : rows.length === 0 ? (
            <TR><TD colSpan={8}><EmptyState message="No transactions match. Import a bank export to get started." /></TD></TR>
          ) : rows.map((t: any) => (
            <TR key={t.id}>
              <TD><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></TD>
              <TD className="whitespace-nowrap align-top text-muted-foreground">{formatDate(t.date)}{t.time ? <span className="ml-1 opacity-70">{t.time.slice(0, 5)}</span> : null}</TD>
              <TD className="truncate align-top text-muted-foreground">{accounts?.find((a) => a.id === t.accountId)?.name}</TD>
              <TD className="align-top">
                <div className="break-words leading-snug" title={t.rawDescription ? `${t.rawDescription}\n— normalized: ${t.description}` : t.description}>
                  {t.description}
                </div>
                <div className="mt-1 flex gap-1">
                  {t.needsReview && <Badge tone="warning">review</Badge>}
                  {(t.isTransfer || catTypeById.get(t.categoryId) === 'transfer') && <Badge tone="default">transfer</Badge>}
                </div>
              </TD>
              <TD>
                <CategorySelect
                  value={t.categoryId}
                  onChange={(id) => updateTx({ id: t.id, body: { categoryId: id, source: 'manual' } })}
                />
              </TD>
              <TD><SourceBadge source={t.source} /></TD>
              <TD className="text-right whitespace-nowrap"><Money amount={t.shareAmount ?? t.amount} signed /></TD>
              <TD>
                <div className="flex gap-1">
                  {t.needsReview && <button onClick={async () => { await markReviewed({ ids: [t.id] }); }} className="text-muted-foreground hover:text-emerald-400" title="mark reviewed"><CheckCheck className="h-4 w-4" /></button>}
                  {t.isTransfer && t.linkedTransactionId && <button onClick={() => unlink(t.id)} className="text-muted-foreground hover:text-foreground" title="unlink transfer"><Unlink className="h-4 w-4" /></button>}
                  <button onClick={() => deleteTx(t.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      {/* Pagination */}
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page} of {pageCount} · {total} rows</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setFilters((f: any) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Prev</Button>
          <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setFilters((f: any) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</Button>
        </div>
      </div>

      {showAdd && <AddTransactionDialog onClose={() => setShowAdd(false)} onCreate={async (body) => { await createTx(body); setShowAdd(false); }} />}

      {recatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setRecatOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6">
            <h2 className="mb-4 text-lg font-semibold">Re-categorize transactions</h2>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">Applies current rules first. Anything unmatched is sent to AI for categorization, optionally using web search to identify the merchant.</p>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2"><input type="radio" checked={recatScope === 'selected'} onChange={() => setRecatScope('selected')} disabled={selected.size === 0} /> Selected ({selected.size})</label>
                <label className="flex items-center gap-2"><input type="radio" checked={recatScope === 'all'} onChange={() => setRecatScope('all')} /> All transactions ({total})</label>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={recatWeb} onChange={(e) => setRecatWeb(e.target.checked)} disabled={!aiStatus?.enabled} />
                Use web search to identify merchants {aiStatus?.enabled ? '' : '(needs AI enabled)'}
              </label>
              {!aiStatus?.enabled && <p className="text-xs text-amber-500">AI is disabled — only rules will apply; unmatched transactions stay uncategorized.</p>}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRecatOpen(false)}>Cancel</Button>
              <Button onClick={startRecategorize} disabled={recatScope === 'selected' && selected.size === 0}>Run</Button>
            </div>
          </div>
        </div>
      )}

      {delAllOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-red-500/40 bg-card p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-red-400"><AlertTriangle className="h-5 w-5" /> Delete ALL transactions</h2>
            <p className="mb-3 text-sm text-muted-foreground">This permanently deletes every transaction across all accounts. Accounts, categories, rules, and import-batch metadata are kept. This cannot be undone.</p>
            <p className="mb-2 text-sm">Type <code className="rounded bg-muted px-1">DELETE</code> to confirm:</p>
            <Input value={delAllText} onChange={(e) => setDelAllText(e.target.value)} placeholder="DELETE" autoFocus />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDelAllOpen(false); setDelAllText(''); }}>Cancel</Button>
              <Button variant="ghost" className="text-red-400 hover:text-red-500" disabled={delAllText !== 'DELETE'} onClick={doDeleteAll}>Delete all</Button>
            </div>
          </div>
        </div>
      )}

      <JobProgressModal
        jobId={recatJobId}
        title="Re-categorizing"
        onDone={() => dispatch(api.util.invalidateTags(['Transaction', 'Rule', 'Dashboard', 'Report']))}
        onClose={() => setRecatJobId(null)}
      />
    </div>
  );
}

function AddTransactionDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (body: any) => void }) {
  const { data: accounts } = useListAccountsQuery();
  const [form, setForm] = useState({ accountId: '', date: localISODate(), time: '', description: '', amount: '', categoryId: '' });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Add transaction</h2>
        <div className="space-y-3">
          <Select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
            <option value="">Select account…</option>
            {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
          <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input type="number" step="0.01" placeholder="Amount (negative = expense)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <CategorySelect value={form.categoryId || null} onChange={(id) => setForm({ ...form, categoryId: id || '' })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate({ accountId: form.accountId, date: form.date, time: form.time || null, description: form.description, amount: Number(form.amount), categoryId: form.categoryId || null })}>Add</Button>
        </div>
      </div>
    </div>
  );
}