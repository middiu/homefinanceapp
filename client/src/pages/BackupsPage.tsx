import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DatabaseBackup, Download, Trash2 } from 'lucide-react';
import { useListBackupsQuery, useCreateBackupMutation, useDeleteBackupMutation } from '@/app/api';
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
    </div>
  );
}