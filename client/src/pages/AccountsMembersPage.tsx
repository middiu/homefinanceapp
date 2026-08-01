import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Pencil } from 'lucide-react';
import {
  useListAccountsQuery, useCreateAccountMutation, useUpdateAccountMutation, useDeleteAccountMutation,
  useListMembersQuery, useCreateMemberMutation, useDeleteMemberMutation,
} from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';
import type { AccountType, OwnershipDto } from '@homefinance/shared';
import { formatAUD } from '@/lib/utils';

const COLORS = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#ef4444', '#3b82f6'];

export default function AccountsMembersPage() {
  return (
    <div>
      <PageHeader title="Accounts & Members" subtitle="Manage accounts, ownership splits, and household members" />
      <div className="grid gap-4 xl:grid-cols-2">
        <AccountsTab />
        <MembersTab />
      </div>
    </div>
  );
}

function AccountsTab() {
  const { data } = useListAccountsQuery();
  const { data: members } = useListMembersQuery();
  const [create] = useCreateAccountMutation();
  const [update] = useUpdateAccountMutation();
  const [del] = useDeleteAccountMutation();
  const [editing, setEditing] = useState<any>(null);
  const [linkErr, setLinkErr] = useState('');

  const empty = {
    name: '', institution: '', type: 'transaction' as AccountType, openingBalance: '0',
    linkedRepaymentAccountId: '', creditLimit: '', statementClosingDay: '', paymentDueDay: '',
    ownership: [{ memberId: members?.[0]?.id ?? '', percentage: 100 }] as OwnershipDto[],
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Accounts</CardTitle>
        <Button size="sm" onClick={() => { setLinkErr(''); setEditing({ ...empty, id: '' }) }}><Plus className="h-4 w-4" /> Add</Button>
      </CardHeader>
      <CardContent>
        {(data ?? []).length === 0 ? <EmptyState message="No accounts yet" /> : (
          <div className="space-y-1">
            {(data ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">
                    {a.name} {a.isArchived && <Badge tone="muted">archived</Badge>}
                    {a.type === 'credit_card' && a.creditLimit != null && (
                      <Badge tone="default" className="ml-1">avail {formatAUD(a.creditLimit)}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.institution} · {a.type} · open {formatAUD(a.openingBalance)}
                    {a.type === 'credit_card' && a.linkedRepaymentAccountId && <> · pays from {data?.find((x) => x.id === a.linkedRepaymentAccountId)?.name ?? '?'}</>}
                    {a.type === 'investment' && a.linkedRepaymentAccountId && <> · funded from {data?.find((x) => x.id === a.linkedRepaymentAccountId)?.name ?? '?'}</>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {a.ownership.map((o) => {
                      const m = members?.find((x) => x.id === o.memberId);
                      return <Badge key={o.memberId} tone="muted">{m?.name ?? '?'} {o.percentage}%</Badge>;
                    })}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => { setLinkErr(''); setEditing({
                    id: a.id, name: a.name, institution: a.institution ?? '', type: a.type, openingBalance: String(a.openingBalance), ownership: a.ownership,
                    linkedRepaymentAccountId: a.linkedRepaymentAccountId ?? '', creditLimit: a.creditLimit != null ? String(a.creditLimit) : '',
                    statementClosingDay: a.statementClosingDay != null ? String(a.statementClosingDay) : '', paymentDueDay: a.paymentDueDay != null ? String(a.paymentDueDay) : '',
                  }) }} className="text-muted-foreground hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => del(a.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {editing && (
        <AccountDialog
          accounts={data ?? []}
          members={members ?? []}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              if (editing.id) await update({ id: editing.id, body }).unwrap(); else await create(body).unwrap();
              setEditing(null); setLinkErr('');
            } catch (e: any) {
              setLinkErr(e?.data?.error ?? e?.message ?? 'save failed');
            }
          }}
        />
      )}
      {linkErr && <p className="px-4 pb-3 text-sm text-red-400">{linkErr}</p>}
    </Card>
  );
}

function AccountDialog({ accounts, members, initial, onClose, onSave }: { accounts: any[]; members: any[]; initial: any; onClose: () => void; onSave: (b: any) => void }) {
  const [f, setF] = useState<any>(initial);
  const [ownership, setOwnership] = useState<OwnershipDto[]>(initial.ownership ?? []);
  const sum = ownership.reduce((s, o) => s + (Number(o.percentage) || 0), 0);
  const isCc = f.type === 'credit_card';
  const isInv = f.type === 'investment';
  const hasLink = isCc || isInv; // both pair with a funding/repayment source account
  const linkedOptions = accounts.filter((a) => a.id !== initial.id && a.type !== 'credit_card');
  const valid = Math.abs(sum - 100) < 0.01 && f.name && ownership.every((o) => o.memberId) && (!isCc || f.linkedRepaymentAccountId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="mb-4 text-lg font-semibold">{initial.id ? 'Edit account' : 'Add account'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><Label>Institution</Label><Input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} /></div>
          <div><Label>Type</Label><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="transaction">Transaction</option><option value="savings">Savings</option><option value="credit_card">Credit Card</option><option value="loan">Loan</option><option value="investment">Investment</option></Select></div>
          <div><Label>Opening balance</Label><Input type="number" step="0.01" value={f.openingBalance} onChange={(e) => setF({ ...f, openingBalance: e.target.value })} /></div>
        </div>
        {hasLink && (
          <div className="mt-3 rounded-md border border-border p-3">
            <div className="mb-2 text-sm font-medium">{isCc ? 'Credit card settings' : 'Investment settings'}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>{isCc ? 'Linked repayment account (required)' : 'Funding account (optional)'}</Label>
                <Select value={f.linkedRepaymentAccountId ?? ''} onChange={(e) => setF({ ...f, linkedRepaymentAccountId: e.target.value })}>
                  <option value="">{isCc ? 'Select repayment account…' : 'Select funding account…'}</option>
                  {linkedOptions.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isCc
                    ? 'Transfers between this card and the linked account are auto-detected and excluded from spend.'
                    : 'Deposits arriving here from the funding account are auto-matched and excluded from spend.'}
                </p>
              </div>
              {isCc && <>
                <div><Label>Credit limit (AUD)</Label><Input type="number" step="0.01" value={f.creditLimit ?? ''} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /></div>
                <div><Label>Statement closing day (1-31)</Label><Input type="number" min={1} max={31} value={f.statementClosingDay ?? ''} onChange={(e) => setF({ ...f, statementClosingDay: e.target.value })} /></div>
                <div><Label>Payment due day (1-31)</Label><Input type="number" min={1} max={31} value={f.paymentDueDay ?? ''} onChange={(e) => setF({ ...f, paymentDueDay: e.target.value })} /></div>
              </>}
            </div>
          </div>
        )}
        <div className="mt-3">
          <Label>Ownership split (must sum to 100%)</Label>
          <div className="mt-1 space-y-1">
            {ownership.map((o, i) => (
              <div key={i} className="flex gap-2">
                <Select value={o.memberId} onChange={(e) => setOwnership(ownership.map((x, j) => j === i ? { ...x, memberId: e.target.value } : x))} className="flex-1">
                  <option value="">Select member…</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
                <Input type="number" step="0.01" value={o.percentage} onChange={(e) => setOwnership(ownership.map((x, j) => j === i ? { ...x, percentage: Number(e.target.value) } : x))} className="w-24" />
                <Button variant="ghost" size="icon" onClick={() => setOwnership(ownership.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => setOwnership([...ownership, { memberId: '', percentage: 0 }])}><Plus className="h-4 w-4" /> Add owner</Button>
            <span className={Math.abs(sum - 100) < 0.01 ? 'text-emerald-400' : 'text-amber-400'}>Sum: {sum}%</span>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSave({
            name: f.name, institution: f.institution || null, type: f.type, openingBalance: Number(f.openingBalance), ownership,
            ...(hasLink ? { linkedRepaymentAccountId: f.linkedRepaymentAccountId || null } : { linkedRepaymentAccountId: null }),
            ...(isCc ? {
              creditLimit: f.creditLimit ? Number(f.creditLimit) : null,
              statementClosingDay: f.statementClosingDay ? Number(f.statementClosingDay) : null,
              paymentDueDay: f.paymentDueDay ? Number(f.paymentDueDay) : null,
            } : { creditLimit: null, statementClosingDay: null, paymentDueDay: null }),
          })}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function MembersTab() {
  const { data } = useListMembersQuery();
  const [create] = useCreateMemberMutation();
  const [del] = useDeleteMemberMutation();
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  return (
    <Card>
      <CardHeader><CardTitle>Household members</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {(data ?? []).length === 0 ? <EmptyState message="No members yet" /> : (
          <div className="space-y-1">
            {(data ?? []).map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-4 rounded-full" style={{ background: m.color }} />
                  <span className="text-sm font-medium">{m.name}</span>
                </div>
                <button onClick={() => del(m.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emilio" /></div>
          <div>
            <Label>Color</Label>
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-ring' : ''}`} style={{ background: c }} />
              ))}
            </div>
          </div>
          <Button onClick={() => { if (name) { create({ name, color }); setName(''); } }}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </CardContent>
    </Card>
  );
}