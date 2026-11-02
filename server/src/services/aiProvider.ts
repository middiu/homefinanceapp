import { Ollama } from 'ollama';
import { eq } from 'drizzle-orm';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  AI_PROVIDER_ENDPOINTS,
  CURSOR_MODELS,
  GROK_MODELS,
  OLLAMA_CLOUD_MODELS,
  aiModelFitsProvider,
  type AiProviderId,
} from '@homefinance/shared';
import type { AiConfigDto, AiConfigUpdate, AiConnectionTestResult } from '@homefinance/shared';
import { config } from '../config.js';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';

// Outbound AI calls. Ollama keeps a configurable host (cloud or local). Grok and
// Cursor are pinned to their official HTTPS origins so a settings write or a
// connection test cannot redirect the stored API key (SSRF / key exfiltration).
// Keys are per provider and never returned to the client.

const MODEL_RE = /^[A-Za-z0-9._:@+\-]{1,128}$/;
const AGENT_ID_RE = /^bc-[A-Za-z0-9-]+$/;
const RUN_ID_RE = /^run-[A-Za-z0-9-]+$/;
const MAX_PROMPT_CHARS = 24_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const CURSOR_TIMEOUT_MS = 180_000;
const CURSOR_POLL_MS = 2_000;

export class AiConfigError extends Error {
  readonly category: 'url' | 'model' | 'auth';
  constructor(message: string, category: 'url' | 'model' | 'auth' = 'url') {
    super(message);
    this.name = 'AiConfigError';
    this.category = category;
  }
}

class AiHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiHttpError';
    this.status = status;
  }
}

interface ProviderTarget {
  provider: AiProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiRuntime extends ProviderTarget {
  enabled: boolean;
  keys: Record<AiProviderId, string>;
}

function getSetting(key: string): string | null {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row ? row.value : null;
}

function setSetting(key: string, value: string) {
  const db = getDb();
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (existing) db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  else db.insert(schema.settings).values({ key, value }).run();
}

export function isSafeModelId(model: string): boolean {
  return MODEL_RE.test(model);
}

function requireModelId(model: string): string {
  const id = (model || '').trim();
  if (!isSafeModelId(id)) throw new AiConfigError('Model id contains unsupported characters', 'model');
  return id;
}

/** Normalize an Ollama host URL. Legacy installs stored the OpenAI-compatible
 *  `https://ollama.com/v1`; the native client wants the bare host. */
export function normalizeHost(url: string): string {
  let h = (url || '').trim();
  h = h.replace(/\/v1\/?$/i, '');
  h = h.replace(/\/+$/, '');
  return h || 'https://ollama.com';
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'metadata.google.internal' || host.endsWith('.metadata.google.internal')) return true;
  if (host === 'metadata' || host === 'metadata.google') return true;
  // Decimal or hex IP literals (bypass dotted-quad checks).
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  if (host === '::') return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return true;
  const [a, b] = parts;
  // Link-local (cloud metadata) and 0.0.0.0/8. Loopback and RFC1918 stay allowed
  // so a local or LAN Ollama server still works.
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Validate a user-supplied Ollama base URL before it is saved or dialed. */
export function assertOllamaBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL((raw || '').trim());
  } catch {
    throw new AiConfigError('Base URL must be an absolute http:// or https:// URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiConfigError('Base URL must start with http:// or https://');
  }
  if (url.username || url.password) {
    throw new AiConfigError('Base URL must not include credentials');
  }
  if (isBlockedHost(url.hostname)) {
    throw new AiConfigError('That host is not allowed');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

export function ollamaHostsMatch(a: string, b: string): boolean {
  try {
    const ua = new URL(normalizeHost(a));
    const ub = new URL(normalizeHost(b));
    const port = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');
    return ua.protocol === ub.protocol && ua.hostname.toLowerCase() === ub.hostname.toLowerCase() && port(ua) === port(ub);
  } catch {
    return false;
  }
}

export function redactSecrets(message: string, ...secrets: string[]): string {
  let s = message || '';
  for (const secret of secrets) {
    if (secret && secret.length >= 6) s = s.split(secret).join('[redacted]');
  }
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  s = s.replace(/\b(?:sk|xai|cursor)[-_][A-Za-z0-9_\-]{8,}\b/gi, '[redacted]');
  return s.slice(0, 400);
}

function envKey(provider: AiProviderId): string {
  if (provider === 'grok' && config.ai.grokApiKey) return config.ai.grokApiKey;
  if (provider === 'cursor' && config.ai.cursorApiKey) return config.ai.cursorApiKey;
  if (provider === config.ai.provider && config.ai.apiKey) return config.ai.apiKey;
  return '';
}

function dbKey(provider: AiProviderId): string {
  const specific = getSetting(`ai.apiKey.${provider}`);
  if (specific) return specific;
  // Pre-provider installs stored a single key. That key belongs to Ollama.
  if (provider === 'ollama') {
    const legacy = getSetting('ai.apiKey');
    if (legacy) return legacy;
  }
  return '';
}

function keyFor(provider: AiProviderId): string {
  return dbKey(provider) || envKey(provider);
}

function configuredProvider(): AiProviderId {
  const raw = getSetting('ai.provider');
  if (raw === 'ollama' || raw === 'grok' || raw === 'cursor') return raw;
  return config.ai.provider;
}

function endpointFor(provider: AiProviderId, ollamaBaseUrl: string): string {
  if (provider === 'grok') return AI_PROVIDER_ENDPOINTS.grok;
  if (provider === 'cursor') return AI_PROVIDER_ENDPOINTS.cursor;
  return ollamaBaseUrl;
}

function configuredModel(provider: AiProviderId): string {
  const stored = (getSetting('ai.model') || config.ai.model || '').trim();
  if (stored && isSafeModelId(stored) && aiModelFitsProvider(provider, stored)) return stored;
  return AI_PROVIDER_DEFAULT_MODEL[provider];
}

export function loadAiRuntime(): AiRuntime {
  const provider = configuredProvider();
  const ollamaBase = getSetting('ai.baseUrl') || config.ai.baseUrl;
  const keys: Record<AiProviderId, string> = {
    ollama: keyFor('ollama'),
    grok: keyFor('grok'),
    cursor: keyFor('cursor'),
  };
  return {
    provider,
    enabled: getSetting('ai.enabled') !== 'false' && config.ai.enabled,
    baseUrl: endpointFor(provider, ollamaBase),
    apiKey: keys[provider],
    model: configuredModel(provider),
    keys,
  };
}

export function readAiConfig(): AiConfigDto {
  const rt = loadAiRuntime();
  const ollamaBase = getSetting('ai.baseUrl') || config.ai.baseUrl;
  const hasApiKey = !!rt.apiKey;
  return {
    provider: rt.provider,
    enabled: rt.enabled,
    baseUrl: ollamaBase,
    endpoint: rt.baseUrl,
    model: rt.model,
    hasApiKey,
    keysConfigured: {
      ollama: !!rt.keys.ollama,
      grok: !!rt.keys.grok,
      cursor: !!rt.keys.cursor,
    },
    digestCron: getSetting('ai.digestCron') || config.ai.digestCron,
    autoCategorize: getSetting('ai.autoCategorize') !== null ? getSetting('ai.autoCategorize') === 'true' : hasApiKey,
  };
}

function shouldReplaceModel(from: AiProviderId, to: AiProviderId, model: string): boolean {
  if (!model) return true;
  if (model === AI_PROVIDER_DEFAULT_MODEL[from]) return true;
  return !aiModelFitsProvider(to, model);
}

export function applyAiConfig(patch: AiConfigUpdate): void {
  const current = configuredProvider();
  const next = patch.provider ?? current;
  if (patch.baseUrl !== undefined && next === 'ollama') {
    assertOllamaBaseUrl(patch.baseUrl);
  }
  const explicitModel = patch.model !== undefined ? patch.model.trim() : undefined;
  if (explicitModel && !isSafeModelId(explicitModel)) {
    throw new AiConfigError('Model id contains unsupported characters', 'model');
  }

  if (patch.provider !== undefined) setSetting('ai.provider', patch.provider);
  if (patch.enabled !== undefined) setSetting('ai.enabled', String(patch.enabled));
  if (patch.baseUrl !== undefined && next === 'ollama') setSetting('ai.baseUrl', assertOllamaBaseUrl(patch.baseUrl));
  if (explicitModel !== undefined || (patch.provider && patch.provider !== current)) {
    const candidate = explicitModel !== undefined ? explicitModel : (getSetting('ai.model') || '').trim();
    const providerChanged = !!(patch.provider && patch.provider !== current);
    const replace = !candidate
      || !aiModelFitsProvider(next, candidate)
      || (providerChanged && shouldReplaceModel(current, next, candidate));
    setSetting('ai.model', replace ? AI_PROVIDER_DEFAULT_MODEL[next] : candidate);
  }
  if (patch.apiKey !== undefined) {
    setSetting(`ai.apiKey.${next}`, patch.apiKey);
    if (next === 'ollama') setSetting('ai.apiKey', patch.apiKey);
  }
  if (patch.digestCron !== undefined) setSetting('ai.digestCron', patch.digestCron);
  if (patch.autoCategorize !== undefined) setSetting('ai.autoCategorize', String(patch.autoCategorize));
}

export function isAiEnabled(): boolean {
  const rt = loadAiRuntime();
  return rt.enabled && !!rt.apiKey;
}

export function isAutoCategorizeEnabled(): boolean {
  const raw = getSetting('ai.autoCategorize');
  if (raw !== null) return raw === 'true';
  return isAiEnabled();
}

function fallbackModels(provider: AiProviderId): string[] {
  if (provider === 'grok') return [...GROK_MODELS];
  if (provider === 'cursor') return [...CURSOR_MODELS];
  return [...OLLAMA_CLOUD_MODELS];
}

export function filterGrokModelIds(ids: string[]): string[] {
  return ids.filter((id) => {
    const s = id.toLowerCase();
    if (!s.startsWith('grok')) return false;
    if (/image|video|imagine|embed|tts|vision|flux|aurora/.test(s)) return false;
    return isSafeModelId(id);
  });
}

export function cursorModelIds(data: unknown): string[] {
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const item of items) {
    const id = typeof item === 'string' ? item : (item as { id?: unknown })?.id;
    if (typeof id === 'string' && isSafeModelId(id)) ids.push(id);
  }
  return ids;
}

export function extractGrokText(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as {
    output_text?: unknown;
    choices?: { message?: { content?: unknown } }[];
    output?: { type?: string; content?: { text?: unknown }[] }[];
  };
  const choice = d.choices?.[0]?.message?.content;
  if (typeof choice === 'string' && choice.trim()) return choice.trim();
  if (Array.isArray(choice)) {
    const joined = choice.map((part) => (typeof part === 'string' ? part : (part as { text?: string })?.text || '')).join('').trim();
    if (joined) return joined;
  }
  if (typeof d.output_text === 'string' && d.output_text.trim()) return d.output_text.trim();
  if (Array.isArray(d.output)) {
    const parts: string[] = [];
    for (const item of d.output) {
      if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
      for (const c of item.content) {
        if (typeof c?.text === 'string') parts.push(c.text);
      }
    }
    const joined = parts.join('\n').trim();
    if (joined) return joined;
  }
  return '';
}

export function buildGrokChatBody(model: string, prompt: string, system?: string) {
  return {
    model: requireModelId(model),
    temperature: 0.2,
    input: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
  };
}

export function buildGrokWebSearchBody(model: string, query: string) {
  return {
    model: requireModelId(model),
    input: [
      {
        role: 'user',
        content: `Reply with a short factual note (under 80 words) identifying this merchant. Do not invent account numbers, card numbers, or personal names.\n\nQuery: ${query}`,
      },
    ],
    tools: [{ type: 'web_search', enable_image_search: false, enable_image_understanding: false }],
  };
}

export function buildCursorRunBody(prompt: string, system: string | undefined, model: string, purpose: 'chat' | 'search') {
  const instruction =
    purpose === 'search'
      ? 'Look up this public merchant question and reply with a short factual snippet only. Do not mention or request account numbers, names, or balances.'
      : 'Reply with the answer only. Do not use tools, do not edit files, do not run commands, and do not browse the web.';
  const text = [instruction, system, prompt].filter(Boolean).join('\n\n');
  // Explicit allow-list of fields. No repos, MCP, env, images, or subagents.
  return {
    name: 'HomeFinance',
    mode: 'plan' as const,
    autoCreatePR: false,
    model: { id: requireModelId(model) },
    prompt: { text },
  };
}

export function interpretCursorRun(run: unknown): { state: 'pending' | 'ok' | 'failed'; text: string } {
  const status = String((run as { status?: unknown } | null)?.status || '').toUpperCase();
  const text = typeof (run as { result?: unknown } | null)?.result === 'string' ? ((run as { result: string }).result).trim() : '';
  if (!status || status === 'CREATING' || status === 'RUNNING' || status === 'WAITING_FOR_BACKGROUND_WORK') {
    return { state: 'pending', text: '' };
  }
  if (status === 'FINISHED') return { state: 'ok', text };
  return { state: 'failed', text: text || status };
}

function assertPromptSize(text: string) {
  if (text.length > MAX_PROMPT_CHARS) {
    throw new AiConfigError('Prompt is too large to send to the provider', 'model');
  }
}

function assertPinnedUrl(url: string) {
  const u = new URL(url);
  const allowed = u.protocol === 'https:' && (u.hostname === 'api.x.ai' || u.hostname === 'api.cursor.com');
  if (!allowed) throw new AiConfigError('Refusing to call an unexpected provider host');
}

function errorMessage(parsed: unknown): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const p = parsed as { error?: unknown; message?: unknown };
  if (typeof p.error === 'string') return p.error;
  if (p.error && typeof p.error === 'object' && typeof (p.error as { message?: unknown }).message === 'string') {
    return (p.error as { message: string }).message;
  }
  if (typeof p.message === 'string') return p.message;
  return '';
}

async function pinnedRequest(url: string, apiKey: string, method: string, body: unknown | undefined, timeoutMs: number): Promise<unknown> {
  assertPinnedUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'error',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_RESPONSE_BYTES) throw new AiHttpError('Provider response too large', res.status);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw new AiHttpError('Provider response too large', res.status);
    const text = new TextDecoder().decode(buf);
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text.slice(0, 300) };
      }
    }
    if (!res.ok) {
      const msg = redactSecrets(errorMessage(parsed) || `HTTP ${res.status}`, apiKey);
      throw new AiHttpError(msg, res.status);
    }
    return parsed;
  } catch (e) {
    if (e instanceof AiHttpError || e instanceof AiConfigError) throw e;
    const aborted = (e as Error).name === 'AbortError';
    const msg = aborted ? 'Provider request timed out' : (e as Error).message || 'request failed';
    throw new AiHttpError(redactSecrets(msg, apiKey), 0);
  } finally {
    clearTimeout(timer);
  }
}

/** Chat stays on the configured host. Merchant search may only call Ollama's
 *  public web-search endpoints, which the SDK hard-codes. */
export function isAllowedOllamaRequest(allowedHost: string, requestUrl: string): boolean {
  const allowed = new URL(allowedHost);
  const url = new URL(requestUrl);
  const portOf = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');
  const sameHost = url.protocol === allowed.protocol
    && url.hostname.toLowerCase() === allowed.hostname.toLowerCase()
    && portOf(url) === portOf(allowed);
  const ollamaWeb = url.protocol === 'https:'
    && url.hostname === 'ollama.com'
    && (url.pathname === '/api/web_search' || url.pathname === '/api/web_fetch');
  return sameHost || ollamaWeb;
}

function ollamaFetch(allowedHost: string): typeof fetch {
  return (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!isAllowedOllamaRequest(allowedHost, raw)) {
      throw new AiConfigError('Refusing to call an unexpected Ollama host');
    }
    return fetch(raw, { ...(init ?? {}), redirect: 'error' });
  };
}

function ollamaClient(baseUrl: string, apiKey: string): Ollama {
  const host = normalizeHost(assertOllamaBaseUrl(baseUrl));
  return new Ollama({
    host,
    fetch: ollamaFetch(host),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function ollamaModelIds(baseUrl: string, apiKey: string): Promise<string[]> {
  const client = ollamaClient(baseUrl, apiKey);
  const data = await withTimeout(client.list(), 20_000, 'Ollama');
  const raw = (data?.models ?? []) as { name?: string; model?: string }[];
  const ids = raw.map((m) => m.name || m.model || '').filter(Boolean);
  const allow = new Set(OLLAMA_CLOUD_MODELS.map((m) => m.toLowerCase()));
  const present = new Set(ids.map((id) => id.toLowerCase()));
  const filtered = OLLAMA_CLOUD_MODELS.filter((m) => present.has(m.toLowerCase()));
  return filtered.length ? filtered : ids.filter((id) => allow.has(id.toLowerCase()));
}

async function listModels(target: ProviderTarget): Promise<string[]> {
  if (target.provider === 'ollama') return ollamaModelIds(target.baseUrl, target.apiKey);
  if (target.provider === 'grok') {
    const data = await pinnedRequest(`${AI_PROVIDER_ENDPOINTS.grok}/v1/models`, target.apiKey, 'GET', undefined, 20_000);
    const rows = (data as { data?: { id?: string }[] } | null)?.data ?? [];
    return filterGrokModelIds(rows.map((m) => m?.id || '').filter(Boolean));
  }
  const data = await pinnedRequest(`${AI_PROVIDER_ENDPOINTS.cursor}/v1/models`, target.apiKey, 'GET', undefined, 20_000);
  return cursorModelIds(data);
}

async function ollamaChat(target: ProviderTarget, prompt: string, system?: string): Promise<string> {
  const client = ollamaClient(target.baseUrl, target.apiKey);
  const messages = [
    ...(system ? [{ role: 'system' as const, content: system }] : []),
    { role: 'user' as const, content: prompt },
  ];
  const resp = await withTimeout(
    client.chat({ model: requireModelId(target.model), messages, stream: false }),
    120_000,
    'Ollama',
  );
  return resp.message?.content?.trim() || '';
}

async function grokChat(target: ProviderTarget, prompt: string, system: string | undefined, purpose: 'chat' | 'search'): Promise<string> {
  const body = purpose === 'search' ? buildGrokWebSearchBody(target.model, prompt) : buildGrokChatBody(target.model, prompt, system);
  const data = await pinnedRequest(`${AI_PROVIDER_ENDPOINTS.grok}/v1/responses`, target.apiKey, 'POST', body, purpose === 'search' ? 90_000 : 120_000);
  return extractGrokText(data);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deleteCursorAgent(agentId: string, apiKey: string) {
  if (!AGENT_ID_RE.test(agentId)) return;
  try {
    await pinnedRequest(`${AI_PROVIDER_ENDPOINTS.cursor}/v1/agents/${agentId}`, apiKey, 'DELETE', undefined, 20_000);
  } catch (e) {
    console.warn('[ai] failed to delete cursor agent', (e as Error).message);
  }
}

async function cursorChat(target: ProviderTarget, prompt: string, system: string | undefined, purpose: 'chat' | 'search'): Promise<string> {
  const body = buildCursorRunBody(prompt, system, target.model, purpose);
  assertPromptSize(body.prompt.text);
  const created = await pinnedRequest(`${AI_PROVIDER_ENDPOINTS.cursor}/v1/agents`, target.apiKey, 'POST', body, 30_000);
  const agentId = (created as { agent?: { id?: string } } | null)?.agent?.id || '';
  const runId = (created as { run?: { id?: string }; agent?: { latestRunId?: string } } | null)?.run?.id
    || (created as { agent?: { latestRunId?: string } } | null)?.agent?.latestRunId
    || '';
  if (!AGENT_ID_RE.test(agentId) || !RUN_ID_RE.test(runId)) {
    throw new AiHttpError('Cursor returned an unexpected agent id', 502);
  }
  const deadline = Date.now() + (purpose === 'search' ? 90_000 : CURSOR_TIMEOUT_MS);
  try {
    while (Date.now() < deadline) {
      const run = await pinnedRequest(
        `${AI_PROVIDER_ENDPOINTS.cursor}/v1/agents/${agentId}/runs/${runId}`,
        target.apiKey,
        'GET',
        undefined,
        20_000,
      );
      const interpreted = interpretCursorRun(run);
      if (interpreted.state === 'ok') {
        if (!interpreted.text) throw new AiHttpError('Cursor returned an empty reply', 502);
        return interpreted.text;
      }
      if (interpreted.state === 'failed') {
        throw new AiHttpError(redactSecrets(`Cursor run failed: ${interpreted.text}`, target.apiKey), 502);
      }
      await sleep(CURSOR_POLL_MS);
    }
    try {
      await pinnedRequest(
        `${AI_PROVIDER_ENDPOINTS.cursor}/v1/agents/${agentId}/runs/${runId}/cancel`,
        target.apiKey,
        'POST',
        {},
        15_000,
      );
    } catch {
      /* already finished or not cancellable */
    }
    throw new AiHttpError('Cursor timed out', 0);
  } finally {
    await deleteCursorAgent(agentId, target.apiKey);
  }
}

export async function runProviderChat(target: ProviderTarget, prompt: string, system?: string, purpose: 'chat' | 'search' = 'chat'): Promise<string> {
  assertPromptSize(`${system || ''}\n${prompt}`);
  if (!target.apiKey) throw new AiConfigError('No API key configured', 'auth');
  if (target.provider === 'ollama') {
    if (purpose === 'search') return ollamaWebSearch(target, prompt);
    return ollamaChat(target, prompt, system);
  }
  if (target.provider === 'grok') return grokChat(target, prompt, system, purpose);
  return cursorChat(target, prompt, system, purpose);
}

async function ollamaWebSearch(target: ProviderTarget, query: string): Promise<string> {
  const client = ollamaClient(target.baseUrl, target.apiKey);
  const res = await withTimeout(client.webSearch({ query, maxResults: 3 }), 30_000, 'Ollama web search');
  return (res.results || []).map((r) => r.content).join('\n').trim();
}

export async function chat(prompt: string, system?: string): Promise<string> {
  const rt = loadAiRuntime();
  if (!rt.enabled || !rt.apiKey) throw new Error('AI not configured (missing API key or disabled)');
  return runProviderChat(rt, prompt, system, 'chat');
}

export function getProvider(): { chat(prompt: string, system?: string): Promise<string> } {
  return { chat };
}

/** Merchant lookup. The query must already be sanitized by the caller. */
export async function aiWebSearch(query: string, maxResults = 3): Promise<string> {
  const rt = loadAiRuntime();
  if (!rt.enabled || !rt.apiKey) return '';
  try {
    if (rt.provider === 'ollama') {
      const client = ollamaClient(rt.baseUrl, rt.apiKey);
      const res = await withTimeout(client.webSearch({ query, maxResults }), 30_000, 'Ollama web search');
      return (res.results || []).map((r) => r.content).join('\n').trim();
    }
    const text = await runProviderChat(rt, query, undefined, 'search');
    return text.slice(0, 400);
  } catch (e) {
    console.warn('[ai] webSearch failed', redactSecrets((e as Error).message, rt.apiKey));
    return '';
  }
}

export async function listCloudModels(): Promise<{ models: string[]; error?: string }> {
  const rt = loadAiRuntime();
  if (!rt.apiKey) return { models: fallbackModels(rt.provider), error: 'No API key configured' };
  try {
    const models = await listModels(rt);
    if (rt.provider === 'ollama') return { models };
    return { models: models.length ? models : fallbackModels(rt.provider) };
  } catch (e) {
    return { models: fallbackModels(rt.provider), error: redactSecrets((e as Error).message, rt.apiKey) };
  }
}

function classify(message: string, status?: number): AiConnectionTestResult['errorCategory'] {
  if (status === 401 || status === 403 || /401|403|unauthor|invalid api key|api key/i.test(message)) return 'auth';
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network|timeout|timed out|aborted/i.test(message)) return 'network';
  if (/base url|not allowed|unexpected provider host|must start with http/i.test(message)) return 'url';
  return 'unexpected';
}

async function logTest(outcome: 'success' | 'failure', latencyMs: number, errorCategory: string | null) {
  try {
    getDb().insert(schema.aiConnectionTestLog).values({ id: uid(), outcome, latencyMs, errorCategory }).run();
  } catch {
    /* ignore logging failures */
  }
}

export async function testConnection(override?: {
  provider?: AiProviderId;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<AiConnectionTestResult> {
  const rt = loadAiRuntime();
  const provider = override?.provider ?? rt.provider;
  const testedAt = new Date().toISOString();
  const pastedKey = (override?.apiKey || '').trim();
  let baseUrl = provider === 'ollama' ? (getSetting('ai.baseUrl') || config.ai.baseUrl) : endpointFor(provider, '');
  let apiKey = pastedKey || (provider === rt.provider ? rt.apiKey : keyFor(provider));

  if (provider === 'ollama') {
    const requested = (override?.baseUrl || '').trim();
    if (requested) {
      const saved = getSetting('ai.baseUrl') || config.ai.baseUrl;
      if (!pastedKey && !ollamaHostsMatch(requested, saved)) {
        return {
          ok: false,
          latencyMs: null,
          errorCategory: 'auth',
          message: 'Enter the API key to test a different base URL. The stored key is only sent to the saved host.',
          testedAt,
        };
      }
      baseUrl = requested;
      if (pastedKey) apiKey = pastedKey;
    }
  }

  const model = (override?.model || (provider === rt.provider ? rt.model : AI_PROVIDER_DEFAULT_MODEL[provider]) || '').trim();
  if (!baseUrl || (provider === 'ollama' && !/^https?:\/\//i.test(baseUrl))) {
    return { ok: false, latencyMs: null, errorCategory: 'url', message: 'Base URL must start with http:// or https://', testedAt };
  }
  if (!apiKey) {
    return { ok: false, latencyMs: null, errorCategory: 'auth', message: 'No API key configured', testedAt };
  }

  const start = Date.now();
  try {
    const models = await listModels({ provider, baseUrl, apiKey, model });
    const latencyMs = Date.now() - start;
    await logTest('success', latencyMs, null);
    const label = provider === 'grok' ? 'Grok' : provider === 'cursor' ? 'Cursor' : 'Ollama';
    const extra = provider === 'cursor' ? ' Chat calls use a short-lived no-repo agent that is deleted after each reply.' : '';
    return {
      ok: true,
      latencyMs,
      errorCategory: null,
      message: `${label} connection OK. ${models.length} model(s) available.${extra}`,
      models,
      testedAt,
    };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const status = e instanceof AiHttpError ? e.status : undefined;
    const category = e instanceof AiConfigError ? (e.category === 'model' ? 'unexpected' : e.category) : classify((e as Error).message, status);
    await logTest('failure', latencyMs, category);
    return {
      ok: false,
      latencyMs,
      errorCategory: category,
      message: redactSecrets((e as Error).message || 'request failed', apiKey),
      testedAt,
    };
  }
}
