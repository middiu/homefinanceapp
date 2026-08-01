import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Sparkles } from 'lucide-react';
import { useGetAiConfigQuery, useUpdateAiConfigMutation, useAiStatusQuery, useGenerateInsightMutation, useLatestInsightQuery } from '@/app/api';
import { PageHeader } from '@/components/common';

export default function AiSettingsPage() {
  const { data } = useGetAiConfigQuery();
  const { data: status } = useAiStatusQuery();
  const [update] = useUpdateAiConfigMutation();
  const [generate] = useGenerateInsightMutation();
  const { data: insight } = useLatestInsightQuery('household');
  const [form, setForm] = useState<any>(null);

  const cfg = form ?? data;

  return (
    <div>
      <PageHeader title="AI & Insights" subtitle="Configure the AI provider (Ollama Cloud) and generate insights" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider configuration</CardTitle>
            <CardDescription>API key is stored server-side only and never sent to the client.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={status?.enabled ? 'success' : 'muted'}>{status?.enabled ? 'AI enabled' : 'AI disabled'}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="enabled" checked={cfg?.enabled} onChange={(e) => setForm({ ...cfg, enabled: e.target.checked })} />
              <Label htmlFor="enabled">Enable AI features (external calls to provider)</Label>
            </div>
            <div><Label>Base URL</Label><Input value={cfg?.baseUrl ?? ''} onChange={(e) => setForm({ ...cfg, baseUrl: e.target.value })} placeholder="https://ollama.com/v1" /></div>
            <div><Label>Model</Label><Input value={cfg?.model ?? ''} onChange={(e) => setForm({ ...cfg, model: e.target.value })} placeholder="llama3.1" /></div>
            <div><Label>API key</Label><Input type="password" value={form?.apiKey ?? ''} onChange={(e) => setForm({ ...cfg, apiKey: e.target.value })} placeholder={data?.hasApiKey ? '•••••• stored (enter to replace)' : 'enter key'} /></div>
            <div><Label>Weekly digest cron</Label><Input value={cfg?.digestCron ?? ''} onChange={(e) => setForm({ ...cfg, digestCron: e.target.value })} placeholder="0 7 * * 1" /></div>
            <Button onClick={() => { update(form ?? {}); setForm(null); }}>Save settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Latest insight</CardTitle><CardDescription>AI-generated · advisory only</CardDescription></CardHeader>
          <CardContent>
            {insight ? (
              <div className="space-y-2">
                <p className="text-sm">{insight.content}</p>
                <p className="text-xs text-muted-foreground">{new Date(insight.generatedAt).toLocaleString('en-AU')}</p>
              </div>
            ) : <p className="text-sm text-muted-foreground">No insight generated yet.</p>}
            <Button variant="outline" size="sm" className="mt-3" onClick={() => generate({ scope: 'household' })}><Sparkles className="h-4 w-4" /> Generate now</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardContent className="pt-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Privacy</p>
          <p>Only aggregated category/amount data is sent to the AI provider — never full account numbers, balances, or raw transaction dumps. Disable AI entirely above if you want no external calls.</p>
        </CardContent>
      </Card>
    </div>
  );
}