import { useEffect, useRef, useState } from 'react';
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
  useGetGrokSubscriptionQuery, useStartGrokSubscriptionMutation, useCancelGrokSubscriptionMutation, useDisconnectGrokSubscriptionMutation,
  useGetCursorSubscriptionQuery, useStartCursorSubscriptionMutation, useCancelCursorSubscriptionMutation, useDisconnectCursorSubscriptionMutation,
} from '@/app/api';
import { PageHeader } from '@/components/common';
import { JobProgressModal } from '@/components/JobProgressModal';
import { formatDate } from '@/lib/utils';
import type { AiConfigDto, AiConfigUpdate, AiConnectionTestResult, AiProviderId, AiSubscriptionView } from '@homefinance/shared';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_ENDPOINTS,
  CURSOR_MODELS,
  GROK_MODELS,
  GROK_SUBSCRIPTION_ENDPOINT,
  OLLAMA_CLOUD_MODELS,
  aiModelFitsProvider,
} from '@homefinance/shared';

type AiForm = AiConfigDto & { apiKey?: string };

const PROVIDERS: { id: AiProviderId; label: string }[] = [
  { id: 'ollama', label: 'Ollama' },
  { id: 'grok', label: 'Grok (xAI)' },
  { id: 'cursor', label: 'Cursor' },
];

function suggestedModels(provider: AiProviderId): string[] {
  if (provider === 'grok') return GROK_MODELS;
  if (provider === 'cursor') return CURSOR_MODELS;
  return OLLAMA_CLOUD_MODELS;
}

function SubscriptionSignIn({ provider }: { provider: 'grok' | 'cursor' }) {
  const dispatch = useDispatch();
  const [watchGrok, setWatchGrok] = useState(false);
  const [watchCursor, setWatchCursor] = useState(false);
  const grok = useGetGrokSubscriptionQuery(undefined, { skip: provider !== 'grok', pollingInterval: watchGrok ? 2000 : 0 });
  const cursor = useGetCursorSubscriptionQuery(undefined, { skip: provider !== 'cursor', pollingInterval: watchCursor ? 2000 : 0 });
  const [startGrok, grokStart] = useStartGrokSubscriptionMutation();
  const [cancelGrok, grokCancel] = useCancelGrokSubscriptionMutation();
  const [disconnectGrok, grokDisconnect] = useDisconnectGrokSubscriptionMutation();
  const [startCursor, cursorStart] = useStartCursorSubscriptionMutation();
  const [cancelCursor, cursorCancel] = useCancelCursorSubscriptionMutation();
  const [disconnectCursor, cursorDisconnect] = useDisconnectCursorSubscriptionMutation();
  const view: AiSubscriptionView | undefined = provider === 'grok' ? grok.data : cursor.data;
  const [actionErr, setActionErr] = useState('');
  const seen = useRef<string | undefined>(undefined);
  const busy = provider === 'grok'
    ? grokStart.isLoading || grokCancel.isLoading || grokDisconnect.isLoading
    : cursorStart.isLoading || cursorCancel.isLoading || cursorDisconnect.isLoading;

  useEffect(() => {
    if (provider === 'grok') setWatchGrok(grok.data?.status === 'pending');
    if (provider === 'cursor') setWatchCursor(cursor.data?.status === 'pending');
  }, [provider, grok.data?.status, cursor.data?.status]);

  useEffect(() => {
    const status = view?.status;
    if (seen.current && seen.current !== 'connected' && status === 'connected') {
      dispatch(api.util.invalidateTags(['Setting']));
    }
    seen.current = status;
  }, [dispatch, view?.status]);

  async function start() {
    setActionErr('');
    try {
      if (provider === 'grok') {
        setWatchGrok(true);
        await startGrok().unwrap();
      } else {
        setWatchCursor(true);
        await startCursor().unwrap();
      }
    } catch (e: any) {
      if (provider === 'grok') setWatchGrok(false);
      else setWatchCursor(false);
      setActionErr(e?.data?.message ?? e?.data?.error ?? 'Could not start sign-in');
    }
  }

  const link = provider === 'grok'
    ? (view?.verificationUriComplete || view?.verificationUri)
    : view?.loginUrl;

  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{provider === 'grok' ? 'Grok subscription' : 'Cursor account'}</p>
        {view?.status === 'connected' && <Badge tone="success">Signed in</Badge>}
        {view?.status === 'pending' && <Badge tone="warning">Waiting for you</Badge>}
      </div>
      <p className="text-xs text-muted-foreground">
        {provider === 'grok'
          ? 'Sign in with a SuperGrok or X Premium subscription. The tokens stay on this server, and Grok requests use that subscription while it is connected. Some plans are refused by xAI; an API key from console.x.ai still works and calls api.x.ai.'
          : 'Sign in with your Cursor account. HomeFinance stores only a user API key minted for this app, valid for about 90 days, billed to your Cursor subscription. Disconnect removes it here. Revoke it in the Cursor dashboard to invalidate it early.'}
      </p>
      {view?.status === 'connected' && (
        <p className="text-xs text-muted-foreground">
          {view.email ? `${view.email}. ` : ''}
          {view.expiresAt ? `Access refreshes or expires ${new Date(view.expiresAt).toLocaleString('en-AU')}.` : 'Connected.'}
        </p>
      )}
      {view?.status === 'pending' && provider === 'grok' && view.userCode && (
        <p className="font-mono text-lg tracking-widest">{view.userCode}</p>
      )}
      {view?.status === 'pending' && link && (
        <a className="text-sm text-primary underline" href={link} target="_blank" rel="noreferrer">
          {provider === 'grok' ? 'Open the xAI sign-in page' : 'Open the Cursor sign-in page'}
        </a>
      )}
      {view?.message && <p className="text-xs text-amber-500">{view.message}</p>}
      {actionErr && <p className="text-xs text-red-400">{actionErr}</p>}
      <div className="flex gap-2">
        {view?.status === 'pending' ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void (provider === 'grok' ? cancelGrok() : cancelCursor()); }}>
            Cancel sign-in
          </Button>
        ) : view?.status === 'connected' ? (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void (provider === 'grok' ? disconnectGrok() : disconnectCursor()); }}>
            Disconnect
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void start(); }}>
            {busy ? 'Starting…' : provider === 'grok' ? 'Sign in with Grok' : 'Sign in with Cursor'}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function AiSettingsPage() {
  const dispatch = useDispatch();
  const { data } = useGetAiConfigQuery();
  const { data: status } = useAiStatusQuery();
  const [update, { isLoading: saving }] = useUpdateAiConfigMutation();
  const [generate] = useGenerateInsightMutation();
  const { data: insight } = useLatestInsightQuery('household');
  const { data: modelsRes } = useListCloudModelsQuery();
  const [test, { isLoading: testing }] = useTestConnectionMutation();
  const { data: history, refetch: refetchHistory } = useTestHistoryQuery();
  const [form, setForm] = useState<AiForm | null>(null);
  const [testResult, setTestResult] = useState<AiConnectionTestResult | null>(null);
  const [testedModels, setTestedModels] = useState<string[] | null>(null);
  const [testErr, setTestErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
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
  const provider: AiProviderId = cfg?.provider ?? 'ollama';
  const providerDirty = !!(form?.provider && data?.provider && form.provider !== data.provider);
  const liveModels = providerDirty ? [] : (modelsRes?.models ?? []);
  const models = testedModels?.length ? testedModels : (liveModels.length ? liveModels : suggestedModels(provider));
  const modelChoices = cfg?.model && !models.includes(cfg.model) ? [cfg.model, ...models] : models;
  const hasKey = data?.keysConfigured?.[provider] ?? false;

  function selectProvider(next: AiProviderId) {
    const prev = (cfg?.provider ?? 'ollama') as AiProviderId;
    const model = cfg?.model ?? '';
    const keep = !!model && model !== AI_PROVIDER_DEFAULT_MODEL[prev] && aiModelFitsProvider(next, model);
    // Drop any key typed for the previous provider so it cannot be saved onto the next one.
    const rest = { ...(cfg ?? {}) } as AiForm;
    delete rest.apiKey;
    setForm({
      ...rest,
      provider: next,
      model: keep ? model : AI_PROVIDER_DEFAULT_MODEL[next],
    });
    setTestResult(null);
    setTestedModels(null);
    setSaveErr('');
  }

  async function save() {
    if (!cfg) return;
    setSaveErr('');
    const body: AiConfigUpdate = {
      provider,
      enabled: cfg.enabled,
      model: cfg.model,
      digestCron: cfg.digestCron,
      autoCategorize: cfg.autoCategorize,
    };
    if (provider === 'ollama') body.baseUrl = cfg.baseUrl;
    if (form && Object.prototype.hasOwnProperty.call(form, 'apiKey')) body.apiKey = form.apiKey ?? '';
    try {
      await update(body).unwrap();
      setForm(null);
      setTestedModels(null);
    } catch (e: any) {
      setSaveErr(e?.data?.error ?? e?.message ?? 'Could not save settings');
    }
  }

  return (
    <div>
      <PageHeader title="AI & Insights" subtitle="Choose Ollama, Grok, or a Cursor model. Keys and subscription sign-in stay on the server." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider configuration</CardTitle>
            <CardDescription>The API key is stored server-side only and is never sent back to the browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge tone={status?.enabled ? 'success' : 'muted'}>{status?.enabled ? 'AI enabled' : 'AI disabled'}</Badge>
              <Badge tone="muted">{PROVIDERS.find((p) => p.id === provider)?.label}</Badge>
              {cfg?.autoCategorize && <Badge tone="warning"><Zap className="mr-1 h-3 w-3" />Auto-categorize ON</Badge>}
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="enabled" checked={!!cfg?.enabled} onChange={(e) => setForm({ ...(cfg as AiConfigDto), enabled: e.target.checked })} />
              <Label htmlFor="enabled">Enable AI features (external calls to the selected provider)</Label>
            </div>
            <div>
              <Label htmlFor="provider">Provider</Label>
              <Select id="provider" value={provider} onChange={(e) => selectProvider(e.target.value as AiProviderId)}>
                {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </Select>
            </div>
            {provider === 'ollama' ? (
              <div>
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input id="baseUrl" value={cfg?.baseUrl ?? ''} onChange={(e) => setForm({ ...(cfg as AiConfigDto), baseUrl: e.target.value })} placeholder="https://ollama.com/v1" />
                <p className="mt-1 text-xs text-muted-foreground">Ollama Cloud or a local server. The stored key is only sent to the saved host.</p>
              </div>
            ) : (
              <div>
                <Label>Endpoint</Label>
                <Input value={provider === 'grok' && data?.subscription?.grok.connected ? GROK_SUBSCRIPTION_ENDPOINT : AI_PROVIDER_ENDPOINTS[provider]} readOnly />
                <p className="mt-1 text-xs text-muted-foreground">
                  {provider === 'grok'
                    ? 'A Grok subscription calls cli-chat-proxy.grok.com. An API key calls api.x.ai. A settings change cannot redirect either credential.'
                    : 'Cursor calls are pinned to api.cursor.com. Each reply is a no-repo plan-mode agent with no repository, MCP, or environment variables, and the agent is deleted after the reply.'}
                </p>
              </div>
            )}
            {(provider === 'grok' || provider === 'cursor') && <SubscriptionSignIn provider={provider} />}
            <div>
              <Label htmlFor="model">Model</Label>
              {modelChoices.length > 0 ? (
                <Select id="model" value={cfg?.model ?? ''} onChange={(e) => setForm({ ...(cfg as AiConfigDto), model: e.target.value })}>
                  <option value="">Select a model…</option>
                  {modelChoices.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              ) : (
                <Input id="model" value={cfg?.model ?? ''} onChange={(e) => setForm({ ...(cfg as AiConfigDto), model: e.target.value })} placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]} />
              )}
              {modelsRes?.error && !providerDirty && <p className="mt-1 text-xs text-amber-500">Model list unavailable: {modelsRes.error}. You can still pick a suggested model.</p>}
              {modelChoices.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{modelChoices.length} model{modelChoices.length === 1 ? '' : 's'} listed.</p>}
            </div>
            <div>
              <Label htmlFor="apiKey">API key</Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="off"
                value={form?.apiKey ?? ''}
                onChange={(e) => setForm({ ...(cfg as AiConfigDto), apiKey: e.target.value })}
                placeholder={hasKey ? '•••••• stored (enter to replace)' : provider === 'grok' ? 'xAI API key' : provider === 'cursor' ? 'Cursor API key' : 'Ollama API key'}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Each provider keeps its own key.
                {provider === 'grok' && ' While a Grok subscription is connected, requests use that sign-in. The API key is used after you disconnect.'}
                {provider === 'cursor' && ' Signing in with Cursor stores a subscription key here. Pasting a key replaces that sign-in.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="autoCat" checked={cfg?.autoCategorize ?? false} onChange={(e) => setForm({ ...(cfg as AiConfigDto), autoCategorize: e.target.checked })} />
              <Label htmlFor="autoCat">Auto-categorize new imports with AI (creates self-updating rules)</Label>
            </div>
            <div>
              <Label htmlFor="digestCron">Weekly digest cron</Label>
              <Input id="digestCron" value={cfg?.digestCron ?? ''} onChange={(e) => setForm({ ...(cfg as AiConfigDto), digestCron: e.target.value })} placeholder="0 7 * * 1" />
            </div>
            {saveErr && <p className="text-sm text-red-400">{saveErr}</p>}
            <Button disabled={saving || !cfg} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connection troubleshooter</CardTitle>
            <CardDescription>Checks that the selected provider accepts the key. Grok and Cursor are contacted only at their pinned hosts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" size="sm" disabled={testing || !cfg} onClick={async () => {
              setTestErr(''); setTestResult(null);
              try {
                const r = await test({
                  provider,
                  baseUrl: provider === 'ollama' ? cfg?.baseUrl : undefined,
                  apiKey: form?.apiKey || undefined,
                  model: cfg?.model,
                }).unwrap();
                setTestResult(r);
                setTestedModels(r.models ?? null);
                refetchHistory();
              } catch (e: any) {
                setTestErr(e?.data?.error ?? e?.message ?? 'request failed');
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
            <p>Categorization sends one sanitized merchant description and the amount. Insights and forecasts send category totals and projection figures only. Account numbers, balances, and raw exports stay on this server. Transfers are skipped.</p>
            {provider === 'grok' && <p className="mt-2">Grok subscription sign-in uses xAI's device login and the Grok subscription proxy. An API key uses the xAI Responses API at api.x.ai. Web lookup, when you ask for it, is xAI web search with image search turned off.</p>}
            {provider === 'cursor' && <p className="mt-2">Cursor has no stateless chat API. A reply runs as a plan-mode agent with no repository access, then that agent is deleted. The prompt still transits Cursor until deletion finishes, and a reply can take a minute or two. Prefer Grok when you want a direct inference call.</p>}
            <p className="mt-2 font-medium text-foreground">Auto-categorize</p>
            <p>When enabled, uncategorized imported transactions are batched (25 at a time). AI categories are saved with a "needs review" flag, and matching rules are created so later imports can skip the model.</p>
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
