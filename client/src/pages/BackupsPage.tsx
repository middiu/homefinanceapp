import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatabaseBackup, Download, Trash2, AlertTriangle } from 'lucide-react';
import { useListBackupsQuery, useCreateBackupMutation, useDeleteBackupMutation, useClearImportHistoryMutation, useListImportBatchesQuery } from '@/app/api';
import { PageHeader, EmptyState } from '@/components/common';

function humanSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupsPage() {
  const { data, refetch } = useListBackupsQuery();
  const [create] = useCreateBackupMutation();
  const [del] = useDeleteBackupMutation();
  const { data: batches } = useListImportBatchesQuery();
  const [clearHistory] = useClearImportHistoryMutation();
  const [dangerOpen, setDangerOpen] = useState(false);
  const [dangerText, setDangerText] = useState('');
  const [dangerErr, setDangerErr] = useState('');
  const [dangerNotice, setDangerNotice] = useState('');

  async function doClearHistory() {
    try {
      const r: any = await clearHistory().unwrap();
      setDangerOpen(false);
      setDangerText('');
      setDangerErr('');
      setDangerNotice(`Deleted ${r.deletedTransactions} imported transaction${r.deletedTransactions === 1 ? '' : 's'} and ${r.deletedBatches} import batch${r.deletedBatches === 1 ? '' : 'es'}.`);
    } catch (e: any) {
      setDangerErr(e?.data?.error ?? e?.message ?? 'delete failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Backups / Data"
        subtitle="Manual and automated SQLite database backups"
        actions={<Button size="sm" onClick={() => create().then(() => refetch())}><DatabaseBackup className="h-4 w-4" /> Backup now</Button>}
      />
      <Card>
        <CardHeader><CardTitle>Backups</CardTitle></CardHeader>
        <CardContent>
          {(data ?? []).length === 0 ? <EmptyState message="No backups yet. A daily cron also runs automatically (default 03:00)." /> : (
            <div className="space-y-1">
              {(data ?? []).map((b) => (
                <div key={b.name} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">{new Date(b.mtime).toLocaleString('en-AU')} · {humanSize(b.size)}</div>
                  </div>
                  <div className="flex gap-1">
                    <a href={`/api/backups/${b.name}/download`} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"><Download className="h-4 w-4" /></a>
                    <button onClick={() => del(b.name).then(() => refetch())} className="rounded-md p-1.5 text-muted-foreground hover:text-red-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="mt-4">
        <CardContent className="pt-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Restore</p>
          <p>To restore, stop the app, replace the SQLite file referenced by <code>DATABASE_URL</code> with a downloaded backup, then restart. See <code>docs/deployment.md</code>.</p>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="mt-4 border-red-500/40">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-red-400">Danger zone</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-500"
            disabled={(batches ?? []).length === 0}
            onClick={() => { setDangerOpen(true); setDangerErr(''); setDangerText(''); }}
          >
            <Trash2 className="h-4 w-4" /> Delete all imported data &amp; history
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Permanently delete every transaction that came from an import (currently{' '}
            <span className="font-medium text-foreground">{(batches ?? []).length}</span>{' '}
            import batch{(batches ?? []).length === 1 ? '' : 'es'}), plus all import-batch history.
            Manually-added transactions, accounts, categories, rules, and settings are kept.
            This cannot be undone — take a backup first.
          </p>
        </CardContent>
      </Card>

      {dangerNotice && !dangerOpen && (
        <div className="mt-3 text-sm text-emerald-400">{dangerNotice}</div>
      )}

      {dangerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDangerOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-lg border border-red-500/40 bg-card p-6">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-red-400">
              <AlertTriangle className="h-5 w-5" /> Delete all imported data &amp; history
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              This permanently deletes every transaction that came from an import, plus all
              import-batch history. Manually-added transactions, accounts, categories, rules, and
              settings are kept. This cannot be undone.
            </p>
            <p className="mb-2 text-sm">Type <code className="rounded bg-muted px-1">DELETE</code> to confirm:</p>
            <Input
              value={dangerText}
              onChange={(e) => setDangerText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
            {dangerErr && <p className="mt-2 text-sm text-red-400">{dangerErr}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setDangerOpen(false); setDangerText(''); setDangerErr(''); }}>Cancel</Button>
              <Button variant="ghost" className="text-red-400 hover:text-red-500" disabled={dangerText !== 'DELETE'} onClick={doClearHistory}>
                Delete all imported data
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}