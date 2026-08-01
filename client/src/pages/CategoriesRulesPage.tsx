import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, ArrowUp, ArrowDown, FlaskConical } from 'lucide-react';
import {
  useListCategoriesQuery, useCreateCategoryMutation, useDeleteCategoryMutation,
  useListRulesQuery, useCreateRuleMutation, useDeleteRuleMutation, useTestRuleMutation, useReorderRulesMutation,
} from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';
import type { RuleMatchType } from '@homefinance/shared';

export default function CategoriesRulesPage() {
  const [tab, setTab] = useState<'cats' | 'rules'>('cats');
  return (
    <div>
      <PageHeader title="Categories & Rules" subtitle="Manage taxonomy and auto-categorization rules" />
      <div className="mb-3 flex gap-2">
        <Button variant={tab === 'cats' ? 'default' : 'outline'} size="sm" onClick={() => setTab('cats')}>Categories</Button>
        <Button variant={tab === 'rules' ? 'default' : 'outline'} size="sm" onClick={() => setTab('rules')}>Rules</Button>
      </div>
      {tab === 'cats' ? <CategoriesTab /> : <RulesTab />}
    </div>
  );
}

function CategoriesTab() {
  const { data } = useListCategoriesQuery();
  const [create] = useCreateCategoryMutation();
  const [del] = useDeleteCategoryMutation();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Categories</CardTitle></CardHeader>
        <CardContent>
          {(data ?? []).length === 0 ? <EmptyState message="No categories" /> : (
            <div className="grid gap-1 sm:grid-cols-2">
              {(data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
                  <span className="text-sm">{c.name} {c.isCustom ? <Badge tone="muted">custom</Badge> : <Badge tone="success">default</Badge>}</span>
                  {c.isCustom && <button onClick={() => del(c.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add category</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pet Supplies" /></div>
          <div>
            <Label>Parent (optional)</Label>
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">— none —</option>
              {(data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <Button onClick={() => { if (name) { create({ name, parentId: parentId || null, isCustom: true }); setName(''); setParentId(''); } }}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function RulesTab() {
  const { data: rules } = useListRulesQuery();
  const { data: cats } = useListCategoriesQuery();
  const [create] = useCreateRuleMutation();
  const [del] = useDeleteRuleMutation();
  const [test] = useTestRuleMutation();
  const [reorder] = useReorderRulesMutation();
  const [form, setForm] = useState<{ matchType: RuleMatchType; matchValue: string; categoryId: string; amountMin: string; amountMax: string }>({
    matchType: 'contains', matchValue: '', categoryId: '', amountMin: '', amountMax: '',
  });
  const [testResult, setTestResult] = useState<number | null>(null);

  function move(idx: number, dir: -1 | 1) {
    const arr = [...(rules ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorder(arr.map((r) => r.id));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Rules (priority order)</CardTitle></CardHeader>
        <CardContent>
          {(rules ?? []).length === 0 ? <EmptyState message="No rules. Add one to auto-categorize on import." /> : (
            <div className="space-y-1">
              {(rules ?? []).map((r, i) => {
                const cat = cats?.find((c) => c.id === r.categoryId);
                return (
                  <div key={r.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <div className="flex flex-col">
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                      <button onClick={() => move(i, 1)} disabled={i === (rules ?? []).length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                    </div>
                    <Badge tone="muted">{r.matchType}</Badge>
                    <code className="flex-1 truncate text-xs">{r.matchValue}</code>
                    {(r.amountMin != null || r.amountMax != null) && <span className="text-xs text-muted-foreground">[{r.amountMin ?? '−'},{r.amountMax ?? '−'}]</span>}
                    <Badge>{cat?.name ?? '?'}</Badge>
                    <button onClick={async () => { const res: any = await test({ matchType: r.matchType, matchValue: r.matchValue, categoryId: r.categoryId, amountMin: r.amountMin, amountMax: r.amountMax }); setTestResult(res.data?.matches ?? 0); }} className="text-muted-foreground hover:text-primary" title="test"><FlaskConical className="h-4 w-4" /></button>
                    <button onClick={() => del(r.id)} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Add rule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Match type</Label>
            <Select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as RuleMatchType })}>
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="regex">Regex</option>
              <option value="amount_range">Amount range</option>
            </Select>
          </div>
          <div><Label>Match value</Label><Input value={form.matchValue} onChange={(e) => setForm({ ...form, matchValue: e.target.value })} placeholder="e.g. woolworths" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Amount min</Label><Input type="number" step="0.01" value={form.amountMin} onChange={(e) => setForm({ ...form, amountMin: e.target.value })} /></div>
            <div><Label>Amount max</Label><Input type="number" step="0.01" value={form.amountMax} onChange={(e) => setForm({ ...form, amountMax: e.target.value })} /></div>
          </div>
          <div>
            <Label>Category</Label>
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Select…</option>
              {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <Button onClick={() => { if (form.matchValue && form.categoryId) { create({ ...form, amountMin: form.amountMin ? Number(form.amountMin) : null, amountMax: form.amountMax ? Number(form.amountMax) : null, isActive: true, priority: 100 }); setForm({ matchType: 'contains', matchValue: '', categoryId: '', amountMin: '', amountMax: '' }); } }}>
            <Plus className="h-4 w-4" /> Add rule
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={async () => { const res: any = await test({ matchType: form.matchType, matchValue: form.matchValue, categoryId: form.categoryId, amountMin: form.amountMin ? Number(form.amountMin) : null, amountMax: form.amountMax ? Number(form.amountMax) : null }); setTestResult(res.data?.matches ?? 0); }}><FlaskConical className="h-4 w-4" /> Test</Button>
            {testResult != null && <span className="text-sm text-muted-foreground">matches {testResult} existing txns</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}