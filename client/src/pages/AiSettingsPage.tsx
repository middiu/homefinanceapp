import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Sparkles, Zap, Activity, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import {
  useGetAiConfigQuery, useUpdateAiConfigMutation, useAiStatusQuery, useGenerateInsightMutation, useLatestInsightQuery,
  useListCloudModelsQuery, useTestConnectionMutation, useTestHistoryQuery, api,
} from '@/app/api';
import { PageHeader } from '@/components/common';
import { JobProgressModal } from '@/components/JobProgressModal';
import { formatDate } from '@/lib/utils';
import type { AiConnectionTestResult } from '@homefinance/shared';

export default function AiSettingsPage() {
  const dispatch = useDispatch();
  const { data } = useGetAiConfigQuery();
  const { data: status } = useAiStatusQuery();
  const [update] = useUpdateAiConfigMutation();
  const [generate] = useGenerateInsightMutation();
  const { data: insight } = useLatestInsightQuery('household');
  const { data: modelsRes } = useListCloudModelsQuery();
  const [test, { isLoading: testing }] = useTestConnectionMutation();
  const { data: history, refetch: refetchHistory } = useTestHistoryQuery();
  const [form, setForm] = useState<any>(null);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [testErr, setTestErr] = useState('');
  const [insightJobId, setInsightJobId] = useState<string | null>(null);

  async function startInsight() {
    try {
      const r: any = await generate({ scope: 'household' });
      setInsightJobId(r.data?.jobId ?? null);
    } catch {
      /* surfaced via modal */
    }
  }

  const cfg = form ?? data;
  const models = modelsRes?.models ?? [];

  return (
    <div>
      <PageHeader title="AI & Insights" subtitle="Configure the AI provider (Ollama Cloud), test the connection, and generate insights" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider configuration</CardTitle>
            <CardDescription>API key is stored server-side only and never sent to the client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={status?.enabled ? 'success' : 'muted'}>{status?.enabled ? 'AI enabled' : 'AI disabled'}</Badge>
              {cfg?.autoCategorize && <Badge tone="warning"><Zap className="mr-1 h-3 w-3" />Auto-categorize ON</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="enabled" checked={cfg?.enabled} onChange={(e) => setForm({ ...cfg, enabled: e.target.checked })} />
              <Label htmlFor="enabled">Enable AI features (external calls to provider)</Label>
            </div>
            <div><Label>Base URL</Label><Input value={cfg?.baseUrl ?? ''} onChange={(e) => setForm({ ...cfg, baseUrl: e.target.value })} placeholder="https://ollama.com/v1" /></div>
            <div>
              <Label>Model</Label>
              {models.length > 0 ? (
                <Select value={cfg?.model ?? ''} onChange={(e) => setForm({ ...cfg, model: e.target.value })}>
                  <option value="">Select a model…</option>
                  {models.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              ) : (
                <Input value={cfg?.model ?? ''} onChange={(e) => setForm({ ...cfg, model: e.target.value })} placeholder="llama3.1" />
              )}
              {modelsRes?.error && <p className="mt-1 text-xs text-amber-500">Model list unavailable: {modelsRes.error}. Type a model name manually.</p>}
              {models.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{models.length} models available from provider.</p>}
            </div>
            <div><Label>API key</Label><Input type="password" value={form?.apiKey ?? ''} onChange={(e) => setForm({ ...cfg, apiKey: e.target.value })} placeholder={data?.hasApiKey ? '•••••• stored (enter to replace)' : 'enter key'} /></div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="autoCat" checked={cfg?.autoCategorize ?? false} onChange={(e) => setForm({ ...cfg, autoCategorize: e.target.checked })} />
              <Label htmlFor="autoCat">Auto-categorize new imports with AI (creates self-updating rules)</Label>
            </div>
            <div><Label>Weekly digest cron</Label><Input value={cfg?.digestCron ?? ''} onChange={(e) => setForm({ ...cfg, digestCron: e.target.value })} placeholder="0 7 * * 1" /></div>
            <Button onClick={() => { update(form ?? {}); setForm(null); }}>Save settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection troubleshooter</CardTitle>
            <CardDescription>Verify the AI provider responds before relying on AI features.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" disabled={testing} onClick={async () => {
              setTestErr(''); setTestResult(null);
              try {
                const r: any = await test({ baseUrl: cfg?.baseUrl, apiKey: form?.apiKey || undefined });
                setTestResult(r.data);
                refetchHistory();
              } catch (e: any) {
                setTestErr(e.message ?? 'request failed');
              }
            }}>
              <Activity className="h-4 w-4" /> {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testErr && <p className="text-sm text-red-400"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{testErr}</p>}
            {testResult && (
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}
                  <span className="font-medium">{testResult.ok ? 'Connection OK' : 'Connection failed'}</span>
                  {testResult.latencyMs != null && <span className="text-xs text-muted-foreground">{testResult.latencyMs} ms</span>}
                </div>
                <p className="mt-1 text-muted-foreground">{testResult.message}</p>
                {testResult.errorCategory && <Badge tone="danger" className="mt-1">{testResult.errorCategory}</Badge>}
                {testResult.models && testResult.models.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Returned {testResult.models.length} models.</p>
                )}
              </div>
            )}
            <div>
              <Label>Recent test history</Label>
              <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                {(history ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No tests yet.</p> :
                  (history ?? []).map((h) => (
                    <div key={h.id} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs">
                      <span className="flex items-center gap-1.5">
                        {h.outcome === 'success' ? <CheckCircle2 className="h-3 w-3 text-emerald-400" /> : <XCircle className="h-3 w-3 text-red-400" />}
                        {formatDate(h.testedAt.slice(0, 10))}
                        {h.latencyMs != null && <span className="text-muted-foreground">{h.latencyMs}ms</span>}
                      </span>
                      {h.errorCategory && <Badge tone="muted">{h.errorCategory}</Badge>}
                    </div>
                  ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Latest insight</CardTitle><CardDescription>AI-generated · advisory only</CardDescription></CardHeader>
          <CardContent>
            {insight ? (
              <div className="space-y-2">
                <p className="text-sm">{insight.content}</p>
                <p className="text-xs text-muted-foreground">{new Date(insight.generatedAt).toLocaleString('en-AU')}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">No insight generated yet.</p>}
            <Button variant="outline" size="sm" className="mt-3" onClick={startInsight}><Sparkles className="h-4 w-4" /> Generate now</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Privacy</p>
            <p>Only the transaction description and amount are sent to the AI provider for categorization — never account numbers, balances, or full data dumps. Disable AI entirely above if you want no external calls.</p>
            <p className="mt-2 font-medium text-foreground">Auto-categorize</p>
            <p>When enabled, uncategorized imported transactions are batched (25 at a time) to the AI model on import. AI-suggested categories are saved with a "needs review" flag, and matching rules are auto-created so future imports categorize without AI.</p>
          </CardContent>
        </Card>
      </div>

      <JobProgressModal
        jobId={insightJobId}
        title="Generating insight"
        onDone={() => dispatch(api.util.invalidateTags(['Insight']))}
        onClose={() => setInsightJobId(null)}
      />
    </div>
  );
}