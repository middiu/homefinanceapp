import { useMemo, useState } from 'react';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Download, Plus, Trash2 } from 'lucide-react';
import {
  useListTransactionsQuery,
  useListAccountsQuery,
  useListCategoriesQuery,
  useListMembersQuery,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useBulkCategorizeMutation,
  useCreateTransactionMutation,
} from '@/app/api';
import { PageHeader, EmptyState, Money } from '@/components/common';
import { CategorySelect, SourceBadge } from '@/components/CategorySelect';
import { formatAUD, formatDate } from '@/lib/utils';

const PAGE_SIZE = 50;

export default function TransactionsPage() {
  const [filters, setFilters] = useState<any>({ page: 1, pageSize: PAGE_SIZE, sort: 'date:desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const { data: accounts } = useListAccountsQuery();
  const { data: categories } = useListCategoriesQuery();
  const { data: members } = useListMembersQuery();
  const { data, isLoading } = useListTransactionsQuery(filters);
  const [updateTx] = useUpdateTransactionMutation();
  const [deleteTx] = useDeleteTransactionMutation();
  const [bulk] = useBulkCategorizeMutation();
  const [createTx] = useCreateTransactionMutation();

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function set<K extends string>(key: K, value: any) {
    setFilters((f: any) => ({ ...f, [key]: value, page: 1 }));
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
            <Button variant="outline" size="sm" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
            <Button size="sm" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add</Button>
          </>
        }
      />

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Search description…" value={filters.search ?? ''} onChange={(e) => set('search', e.target.value)} className="w-48" />
        <Select value={filters.accountId?.[0] ?? ''} onChange={(e) => set('accountId', e.target.value ? [e.target.value] : undefined)} className="w-44">
          <option value="">All accounts</option>
          {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <Select value={filters.categoryId?.[0] ?? ''} onChange={(e) => set('categoryId', e.target.value ? [e.target.value] : undefined)} className="w-44">
          <option value="">All categories</option>
          {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={filters.memberId?.[0] ?? ''} onChange={(e) => set('memberId', e.target.value ? [e.target.value] : undefined)} className="w-40">
          <option value="">All members</option>
          {members?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
        <Input type="date" value={filters.dateFrom ?? ''} onChange={(e) => set('dateFrom', e.target.value || undefined)} className="w-40" />
        <Input type="date" value={filters.dateTo ?? ''} onChange={(e) => set('dateTo', e.target.value || undefined)} className="w-40" />
        <Select value={filters.sort ?? 'date:desc'} onChange={(e) => setFilters((f: any) => ({ ...f, sort: e.target.value }))} className="w-40">
          <option value="date:desc">Date ↓</option>
          <option value="date:asc">Date ↑</option>
          <option value="amount:desc">Amount ↓</option>
          <option value="amount:asc">Amount ↑</option>
        </Select>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <CategorySelect value={bulkCat} onChange={setBulkCat} className="w-44" />
          <Button size="sm" onClick={async () => { await bulk({ ids: [...selected], categoryId: bulkCat, source: 'manual' }); setSelected(new Set()); }}>Apply category</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      <Table>
        <THead>
          <TR>
            <TH className="w-8"><input type="checkbox" checked={rows.length > 0 && selected.size === rows.length} onChange={toggleAll} /></TH>
            <TH className="w-24">Date</TH>
            <TH className="w-36">Account</TH>
            <TH>Description</TH>
            <TH className="w-44">Category</TH>
            <TH className="w-16">Src</TH>
            <TH className="w-24 text-right">Amount</TH>
            <TH className="w-10"></TH>
          </TR>
        </THead>
        <TBody>
          {isLoading ? (
            <TR><TD colSpan={8}><div className="py-8 text-center text-muted-foreground">Loading…</div></TD></TR>
          ) : rows.length === 0 ? (
            <TR><TD colSpan={8}><EmptyState message="No transactions match. Import a bank export to get started." /></TD></TR>
          ) : rows.map((t: any) => (
            <TR key={t.id}>
              <TD><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} /></TD>
              <TD className="whitespace-nowrap text-muted-foreground">{formatDate(t.date)}</TD>
              <TD className="truncate text-muted-foreground">{accounts?.find((a) => a.id === t.accountId)?.name}</TD>
              <TD className="truncate" title={t.description}>{t.description}</TD>
              <TD>
                <CategorySelect
                  value={t.categoryId}
                  onChange={(id) => updateTx({ id: t.id, body: { categoryId: id, source: 'manual' } })}
                />
              </TD>
              <TD><SourceBadge source={t.source} /></TD>
              <TD className="text-right whitespace-nowrap"><Money amount={t.shareAmount ?? t.amount} signed /></TD>
              <TD>
                <button onClick={() => deleteTx(t.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
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
    </div>
  );
}

function AddTransactionDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (body: any) => void }) {
  const { data: accounts } = useListAccountsQuery();
  const [form, setForm] = useState({ accountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', categoryId: '' });
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
          <Input placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input type="number" step="0.01" placeholder="Amount (negative = expense)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <CategorySelect value={form.categoryId || null} onChange={(id) => setForm({ ...form, categoryId: id || '' })} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate({ accountId: form.accountId, date: form.date, description: form.description, amount: Number(form.amount), categoryId: form.categoryId || null })}>Add</Button>
        </div>
      </div>
    </div>
  );
}