import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Upload, Undo2, Save, FileUp, Sparkles, AlertTriangle } from 'lucide-react';
import {
  useListAccountsQuery,
  useListImportBatchesQuery,
  useDeleteImportBatchMutation,
  useUploadImportMutation,
  useCommitImportMutation,
  useEstimateAiMutation,
  useListMappingsQuery,
  useCreateMappingMutation,
  useDeleteMappingMutation,
  useUpdateAccountMutation,
  api,
} from '@/app/api';
import { useDispatch } from 'react-redux';
import { JobProgressModal } from '@/components/JobProgressModal';
import { PageHeader, EmptyState, Money } from '@/components/common';
import { formatDate, formatAUD } from '@/lib/utils';
import type { ImportFileFormat } from '@homefinance/shared';

const FIELDS = ['date', 'time', 'description', 'amount', 'debit', 'credit', 'balance', 'reference'];

export default function ImportPage() {
  const { data: accounts } = useListAccountsQuery();
  const { data: batches, refetch } = useListImportBatchesQuery();
  const { data: mappings } = useListMappingsQuery();
  const [deleteBatch] = useDeleteImportBatchMutation();
  const [createMapping] = useCreateMappingMutation();
  const [deleteMapping] = useDeleteMappingMutation();
  const [upload] = useUploadImportMutation();
  const [commit] = useCommitImportMutation();
  const [estimateAi] = useEstimateAiMutation();
  const [updateAccount] = useUpdateAccountMutation();

  const [accountId, setAccountId] = useState('');
  const [format, setFormat] = useState<ImportFileFormat>('csv');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string | null>>({});
  const [mappingName, setMappingName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiEstimate, setAiEstimate] = useState<any>(null);
  const [aiEstimating, setAiEstimating] = useState(false);
  const [balancePrompt, setBalancePrompt] = useState<any>(null); // balanceCheck when mismatch needs user resolution
  const [catJobId, setCatJobId] = useState<string | null>(null); // AI categorize job for the last import
  const [notice, setNotice] = useState(''); // post-import confirmation
  const dispatch = useDispatch();

  async function doUpload() {
    if (!file || !accountId) { setError('Select account and file'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('accountId', accountId);
      fd.append('format', format);
      if (format === 'csv') fd.append('columnMap', JSON.stringify(columnMap));
      const r: any = await upload(fd);
      setPreview(r.data);
      setAiEstimate(null);
      // prefill columnMap from headers if empty
      if (format === 'csv' && Object.keys(columnMap).length === 0) {
        const auto: Record<string, string | null> = {};
        for (const f of FIELDS) {
          const guess = (r.data.headers as string[]).find((h) => h.toLowerCase().includes(f === 'date' ? 'date' : f));
          auto[f] = guess || null;
        }
        setColumnMap(auto);
        // re-upload with mapping to get proper amounts
        const fd2 = new FormData();
        fd2.append('file', file);
        fd2.append('accountId', accountId);
        fd2.append('format', format);
        fd2.append('columnMap', JSON.stringify(auto));
        const r2: any = await upload(fd2);
        setPreview(r2.data);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doCommit(resolve?: 'adjust' | 'asis') {
    if (!preview) return;
    // Opening-balance reconciliation gate: if the file exposes an opening
    // balance that disagrees with the account's current balance, ask the user
    // before committing. They choose to adjust the account opening balance,
    // import as-is, or cancel.
    const bc = preview.balanceCheck;
    if (bc && bc.mismatch && !resolve) {
      setBalancePrompt(bc);
      return;
    }
    setBalancePrompt(null);
    setBusy(true); setError('');
    try {
      if (resolve === 'adjust' && bc) {
        await updateAccount({ id: accountId, body: { openingBalance: bc.suggestedOpening } });
      }
      const rows = preview.rows.map((r: any) => ({ date: r.date, time: r.time, description: r.description, amount: r.amount, balance: r.balance, isDuplicate: r.isDuplicate }));
      const res: any = await commit({ accountId, format, fileName: preview.fileName, rows, applyRules: true });
      const data = res.data || {};
      // Records are in the DB now; clear the upload UI immediately. If the server
      // kicked off AI categorization as a background job, surface its progress.
      const dupes = rows.filter((r: any) => r.isDuplicate).length;
      const imported = data.total != null ? data.inserted : rows.length - dupes;
      setNotice(`Imported ${imported} transaction${imported === 1 ? '' : 's'}${data.duplicates ? `, ${data.duplicates} duplicate(s) skipped` : ''}.`);
      setPreview(null); setFile(null); setColumnMap({});
      refetch();
      if (data.jobId) setCatJobId(data.jobId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Import transactions" subtitle="Upload CSV, OFX, or QIF bank exports" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>1. Upload</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Account</Label>
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select…</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
              </Select>
            </div>
            <div>
              <Label>Format</Label>
              <Select value={format} onChange={(e) => setFormat(e.target.value as ImportFileFormat)}>
                <option value="csv">CSV</option>
                <option value="ofx">OFX / QFX</option>
                <option value="qif">QIF</option>
              </Select>
            </div>
            <div>
              <Label>File</Label>
              <Input type="file" accept=".csv,.ofx,.qfx,.qif,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button onClick={doUpload} disabled={busy || !file || !accountId}>
              <Upload className="h-4 w-4" /> {busy ? 'Working…' : 'Upload & preview'}
            </Button>
            {error && <p className="text-sm text-red-400">{error}</p>}
          </CardContent>
        </Card>

        {format === 'csv' && (
          <Card>
            <CardHeader><CardTitle>2. Column mapping</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!preview ? <EmptyState message="Upload a CSV to see columns." /> : (
                <>
                  {FIELDS.map((f) => (
                    <div key={f} className="flex items-center gap-2">
                      <Label className="w-24 capitalize">{f}</Label>
                      <Select
                        value={columnMap[f] ?? ''}
                        onChange={(e) => setColumnMap({ ...columnMap, [f]: e.target.value || null })}
                      >
                        <option value="">— skip —</option>
                        {(preview.headers as string[]).map((h: string) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={doUpload}>Re-apply mapping</Button>
                  <div className="flex gap-2 pt-2">
                    <Input placeholder="Template name" value={mappingName} onChange={(e) => setMappingName(e.target.value)} className="flex-1" />
                    <Button variant="outline" size="sm" disabled={!mappingName} onClick={() => createMapping({ name: mappingName, accountId, format, columnMap, hasHeader: true })}>
                      <Save className="h-4 w-4" /> Save
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {mappings && mappings.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Saved mappings</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {mappings.map((m: any) => (
              <div key={m.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{m.name}</span>
                <Badge tone="muted">{m.format}</Badge>
                <button onClick={() => { setFormat(m.format); setColumnMap(m.columnMap); if (m.accountId) setAccountId(m.accountId); }} className="text-primary hover:underline">Load</button>
                <button onClick={() => deleteMapping(m.id)} className="text-muted-foreground hover:text-red-400">✕</button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {preview && (
        <Card className="mt-4">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Preview ({preview.rows.length} rows)</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={aiEstimating} onClick={async () => {
                setAiEstimating(true);
                try {
                  const rows = preview.rows.filter((r: any) => !r.isDuplicate).map((r: any) => ({ description: r.description, amount: r.amount }));
                  const res: any = await estimateAi({ rows });
                  setAiEstimate(res.data);
                } catch (e: any) { setAiEstimate({ error: e.message }); }
                finally { setAiEstimating(false); }
              }}><Sparkles className="h-4 w-4" /> {aiEstimating ? 'Estimating…' : 'Estimate AI need'}</Button>
              <Button onClick={() => doCommit()} disabled={busy}><FileUp className="h-4 w-4" /> Commit import</Button>
            </div>
          </CardHeader>
          <CardContent>
            {aiEstimate && !aiEstimate.error && (
              <div className="mb-3 rounded-md border border-border bg-muted/30 p-2 text-sm">
                <Badge tone={aiEstimate.autoCategorize ? 'warning' : 'muted'}><Sparkles className="mr-1 h-3 w-3" />{aiEstimate.autoCategorize ? 'Auto-categorize ON' : 'Auto-categorize OFF'}</Badge>
                <span className="ml-2 text-muted-foreground">{aiEstimate.needAi} of {aiEstimate.total} rows would use AI (no matching rule). {aiEstimate.autoCategorize ? 'AI will run on commit.' : 'Enable AI auto-categorize in AI & Insights to run on commit.'}</span>
              </div>
            )}
            {aiEstimate?.error && <p className="mb-3 text-sm text-red-400">{aiEstimate.error}</p>}
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-1">Date</th><th className="p-1">Time</th><th className="p-1">Description</th><th className="p-1 text-right">Amount</th><th className="p-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r: any, i: number) => (
                    <tr key={i} className="border-b">
                      <td className="p-1 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="p-1 whitespace-nowrap text-muted-foreground">{r.time || '—'}</td>
                      <td className="p-1 truncate" title={r.description}>{r.description}</td>
                      <td className="p-1 text-right"><Money amount={r.amount} /></td>
                      <td className="p-1">{r.isDuplicate ? <Badge tone="warning">dup</Badge> : <Badge tone="muted">new</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent>
          {(batches ?? []).length === 0 ? <EmptyState message="No imports yet" /> : (
            <div className="space-y-1">
              {(batches ?? []).map((b) => (
                <div key={b.id} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                  <div>
                    <div className="font-medium">{b.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(b.importedAt.slice(0, 10))} · {b.rowCount} rows · {b.duplicateCount} duplicates
                      {b.aiCategorizedCount > 0 && <> · <Badge tone="warning">AI {b.aiCategorizedCount}</Badge></>}
                      · <Badge tone="muted">{b.fileFormat}</Badge>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => deleteBatch(b.id)}><Undo2 className="h-4 w-4" /> Undo</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {notice && !balancePrompt && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-emerald-500/40 bg-card p-3 text-sm shadow-lg">
          <div className="flex items-start gap-2">
            <span className="text-emerald-400">✓</span>
            <div className="flex-1">{notice}</div>
            <button className="text-muted-foreground hover:text-foreground" onClick={() => setNotice('')}>×</button>
          </div>
        </div>
      )}

      <JobProgressModal
        jobId={catJobId}
        title="Categorizing imported transactions"
        onDone={() => { dispatch(api.util.invalidateTags(['Transaction'])); setNotice('Categorization complete.'); }}
        onClose={() => setCatJobId(null)}
      />

      {balancePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setBalancePrompt(null)} />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-amber-500/40 bg-card p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-amber-400"><AlertTriangle className="h-5 w-5" /> Opening balance mismatch</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              The file's opening balance <strong>{formatAUD(balancePrompt.fileOpening)}</strong> doesn't match this account's current balance <strong>{formatAUD(balancePrompt.accountBalance)}</strong>. Difference: <strong>{formatAUD(balancePrompt.delta)}</strong>.
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              This usually means the account's opening balance is off, or some transactions are missing/duplicated. Updating the opening balance to <strong>{formatAUD(balancePrompt.suggestedOpening)}</strong> makes the account reconcile with this statement.
            </p>
            <div className="flex flex-col gap-2">
              <Button size="sm" onClick={() => doCommit('adjust')}>Update opening balance &amp; import</Button>
              <Button size="sm" variant="outline" onClick={() => doCommit('asis')}>Import as-is (leave opening balance)</Button>
              <Button size="sm" variant="ghost" onClick={() => setBalancePrompt(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}