import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AiSubscriptionView } from '@homefinance/shared';
import { getDb, schema } from '../db/index.js';

function redact(message: string, ...secrets: string[]): string {
  let s = message || '';
  for (const secret of secrets) {
    if (secret && secret.length >= 6) s = s.split(secret).join('[redacted]');
  }
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  return s.slice(0, 400);
}

// Grok subscription sign-in is the public device-code flow xAI publishes for the
// Grok CLI (discovery: https://auth.x.ai/.well-known/openid-configuration).
// The access token is a bearer for the subscription proxy, not an API key.
// Cursor sign-in follows Cursor.auth.login(): PKCE at cursor.com, POST poll
// (verifier stays in the body), then one DashboardService call that mints a
// user API key. The session tokens are dropped. Neither secret is returned
// to the browser.

const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const GROK_SCOPE = 'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write';
const GROK_DEVICE_URL = 'https://auth.x.ai/oauth2/device/code';
const GROK_TOKEN_URL = 'https://auth.x.ai/oauth2/token';
const GROK_DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const GROK_OAUTH_KEY = 'ai.oauth.grok';
const GROK_VERSION_URL = 'https://x.ai/cli/stable';
const GROK_VERSION_FALLBACK = '1.0.70';

const CURSOR_WEB = 'https://cursor.com';
const CURSOR_API = 'https://api2.cursor.sh';
const CURSOR_OAUTH_KEY = 'ai.oauth.cursor';
const CURSOR_KEY_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const CURSOR_KEY_NAME = 'HomeFinance';

interface GrokRecord {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string | null;
}

interface CursorRecord {
  via: 'subscription';
  email: string | null;
  expiresAt: string;
}

interface GrokPending {
  gen: number;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: number;
  intervalMs: number;
  status: 'pending' | 'denied' | 'expired' | 'error';
  message?: string;
  timer?: ReturnType<typeof setTimeout>;
}

interface CursorPending {
  gen: number;
  uuid: string;
  verifier: string;
  loginUrl: string;
  expiresAt: number;
  delayMs: number;
  failures: number;
  status: 'pending' | 'error';
  message?: string;
  timer?: ReturnType<typeof setTimeout>;
}

let grokPending: GrokPending | null = null;
let cursorPending: CursorPending | null = null;
let grokGen = 0;
let cursorGen = 0;
let autoPoll = true;
let refreshing: Promise<string | null> | null = null;
let grokClientVersion = GROK_VERSION_FALLBACK;
let grokVersionFetchedAt = 0;

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

function deleteSetting(key: string) {
  getDb().delete(schema.settings).where(eq(schema.settings.key, key)).run();
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function allowedVerificationUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && (url.hostname === 'accounts.x.ai' || url.hostname === 'auth.x.ai');
  } catch {
    return false;
  }
}

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { email?: unknown };
    const email = json.email;
    if (typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+$/.test(email)) return email;
  } catch {
    /* ignore malformed tokens */
  }
  return null;
}

function readGrok(): GrokRecord | null {
  const raw = getSetting(GROK_OAUTH_KEY);
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as Partial<GrokRecord>;
    if (!json || typeof json.accessToken !== 'string' || typeof json.refreshToken !== 'string') return null;
    if (!json.accessToken || !json.refreshToken) return null;
    return {
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      expiresAt: Number(json.expiresAt) || 0,
      email: typeof json.email === 'string' ? json.email : null,
    };
  } catch {
    return null;
  }
}

function writeGrok(record: GrokRecord) {
  setSetting(GROK_OAUTH_KEY, JSON.stringify(record));
}

function readCursor(): CursorRecord | null {
  const raw = getSetting(CURSOR_OAUTH_KEY);
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as Partial<CursorRecord>;
    if (json?.via !== 'subscription') return null;
    return {
      via: 'subscription',
      email: typeof json.email === 'string' ? json.email : null,
      expiresAt: typeof json.expiresAt === 'string' ? json.expiresAt : '',
    };
  } catch {
    return null;
  }
}

export function hasGrokSubscription(): boolean {
  return !!readGrok()?.refreshToken;
}

export function grokSubscriptionSummary(): { connected: boolean; email: string | null; expiresAt: string | null } {
  const row = readGrok();
  if (!row?.refreshToken) return { connected: false, email: null, expiresAt: null };
  return {
    connected: true,
    email: row.email,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  };
}

export function cursorSubscriptionSummary(): { connected: boolean; email: string | null; expiresAt: string | null } {
  const row = readCursor();
  const key = getSetting('ai.apiKey.cursor');
  if (!row || !key) return { connected: false, email: null, expiresAt: null };
  return { connected: true, email: row.email, expiresAt: row.expiresAt || null };
}

/** A pasted Cursor key replaces the subscription marker so disconnect leaves that key alone. */
export function noteCursorApiKeyReplaced() {
  deleteSetting(CURSOR_OAUTH_KEY);
}

function grokView(): AiSubscriptionView {
  if (grokPending) {
    return {
      status: grokPending.status,
      userCode: grokPending.status === 'pending' ? grokPending.userCode : undefined,
      verificationUri: grokPending.status === 'pending' ? grokPending.verificationUri : undefined,
      verificationUriComplete: grokPending.status === 'pending' ? grokPending.verificationUriComplete ?? undefined : undefined,
      codeExpiresAt: grokPending.status === 'pending' ? new Date(grokPending.expiresAt).toISOString() : undefined,
      message: grokPending.message,
    };
  }
  const summary = grokSubscriptionSummary();
  if (summary.connected) return { status: 'connected', email: summary.email, expiresAt: summary.expiresAt };
  return { status: 'idle' };
}

function cursorView(): AiSubscriptionView {
  if (cursorPending) {
    return {
      status: cursorPending.status,
      loginUrl: cursorPending.status === 'pending' ? cursorPending.loginUrl : undefined,
      codeExpiresAt: cursorPending.status === 'pending' ? new Date(cursorPending.expiresAt).toISOString() : undefined,
      message: cursorPending.message,
    };
  }
  const summary = cursorSubscriptionSummary();
  if (summary.connected) return { status: 'connected', email: summary.email, expiresAt: summary.expiresAt };
  return { status: 'idle' };
}

function clearGrokTimer() {
  if (grokPending?.timer) clearTimeout(grokPending.timer);
}

function clearCursorTimer() {
  if (cursorPending?.timer) clearTimeout(cursorPending.timer);
}

async function formPost(url: string, body: URLSearchParams, secrets: string[]): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const allowed = url === GROK_DEVICE_URL || url === GROK_TOKEN_URL;
  if (!allowed) throw new Error('Refusing to call an unexpected Grok auth host');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = { error_description: text.slice(0, 180) };
      }
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    const message = redact((e as Error).message || 'Grok sign-in request failed', ...secrets);
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

function saveTokenResponse(json: Record<string, unknown>, previousEmail: string | null) {
  const accessToken = json.access_token;
  const refreshToken = json.refresh_token;
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || !accessToken || !refreshToken) {
    throw new Error('xAI did not return a refresh token. Start sign-in again.');
  }
  const expiresIn = Number(json.expires_in);
  const expiresAt = Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000;
  writeGrok({
    accessToken,
    refreshToken,
    expiresAt,
    email: emailFromIdToken(json.id_token) ?? previousEmail,
  });
}

export async function startGrokSignIn(): Promise<AiSubscriptionView> {
  clearGrokTimer();
  grokPending = null;
  const result = await formPost(GROK_DEVICE_URL, new URLSearchParams({
    client_id: GROK_CLIENT_ID,
    scope: GROK_SCOPE,
  }), []);
  if (!result.ok) {
    const detail = typeof result.json.error_description === 'string' ? result.json.error_description : `HTTP ${result.status}`;
    throw new Error(redact(`Grok sign-in could not start: ${detail}`).slice(0, 300));
  }
  const userCode = String(result.json.user_code || '');
  const deviceCode = String(result.json.device_code || '');
  const verificationUri = String(result.json.verification_uri || '');
  const completeRaw = result.json.verification_uri_complete ? String(result.json.verification_uri_complete) : '';
  if (!/^[A-Za-z0-9-]{4,64}$/.test(userCode) || !deviceCode || !allowedVerificationUrl(verificationUri)) {
    throw new Error('xAI returned an unexpected sign-in response');
  }
  const expiresIn = Number(result.json.expires_in);
  const interval = Number(result.json.interval);
  const gen = ++grokGen;
  grokPending = {
    gen,
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete: completeRaw && allowedVerificationUrl(completeRaw) ? completeRaw : null,
    expiresAt: Date.now() + Math.min(Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300, 3600) * 1000,
    intervalMs: Math.min(30_000, Math.max(5_000, (Number.isFinite(interval) && interval > 0 ? interval : 5) * 1000)),
    status: 'pending',
  };
  armGrok(gen, grokPending.intervalMs);
  return grokView();
}

function armGrok(gen: number, delay: number) {
  if (!autoPoll || !grokPending || grokPending.gen !== gen) return;
  const timer = setTimeout(() => {
    void stepGrok(gen);
  }, delay);
  timer.unref?.();
  grokPending.timer = timer;
}

async function stepGrok(gen: number) {
  if (!grokPending || grokPending.gen !== gen || grokPending.status !== 'pending') return;
  if (Date.now() >= grokPending.expiresAt) {
    grokPending.status = 'expired';
    grokPending.message = 'That sign-in code expired. Start again.';
    grokPending.deviceCode = '';
    return;
  }
  await pollGrokSignInOnce();
  if (grokPending && grokPending.gen === gen && grokPending.status === 'pending') armGrok(gen, grokPending.intervalMs);
}

export async function pollGrokSignInOnce(): Promise<AiSubscriptionView> {
  const pending = grokPending;
  if (!pending || pending.status !== 'pending') return grokView();
  let result: { ok: boolean; status: number; json: Record<string, unknown> };
  try {
    result = await formPost(GROK_TOKEN_URL, new URLSearchParams({
      grant_type: GROK_DEVICE_GRANT,
      client_id: GROK_CLIENT_ID,
      device_code: pending.deviceCode,
    }), [pending.deviceCode]);
  } catch (e) {
    pending.status = 'error';
    pending.message = (e as Error).message;
    pending.deviceCode = '';
    return grokView();
  }
  if (result.ok) {
    try {
      saveTokenResponse(result.json, readGrok()?.email ?? null);
      grokPending = null;
    } catch (e) {
      pending.status = 'error';
      pending.message = (e as Error).message;
      pending.deviceCode = '';
    }
    return grokView();
  }
  const error = String(result.json.error || '');
  if (error === 'authorization_pending') return grokView();
  if (error === 'slow_down') {
    pending.intervalMs = Math.min(30_000, pending.intervalMs + 5_000);
    return grokView();
  }
  pending.deviceCode = '';
  if (error === 'access_denied' || error === 'authorization_denied') {
    pending.status = 'denied';
    pending.message = 'The Grok sign-in was declined.';
    return grokView();
  }
  if (error === 'expired_token') {
    pending.status = 'expired';
    pending.message = 'That sign-in code expired. Start again.';
    return grokView();
  }
  const detail = typeof result.json.error_description === 'string' ? result.json.error_description : error || `HTTP ${result.status}`;
  pending.status = 'error';
  pending.message = redact(detail, pending.deviceCode).slice(0, 300);
  return grokView();
}

export function grokSignInStatus(): AiSubscriptionView {
  return grokView();
}

export function cancelGrokSignIn(): AiSubscriptionView {
  clearGrokTimer();
  grokGen += 1;
  grokPending = null;
  return grokView();
}

export function disconnectGrok(): AiSubscriptionView {
  clearGrokTimer();
  grokGen += 1;
  grokPending = null;
  deleteSetting(GROK_OAUTH_KEY);
  return grokView();
}

async function refreshGrok(row: GrokRecord): Promise<string | null> {
  const staleRefresh = row.refreshToken;
  let result: { ok: boolean; status: number; json: Record<string, unknown> };
  try {
    result = await formPost(GROK_TOKEN_URL, new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: staleRefresh,
      client_id: GROK_CLIENT_ID,
    }), [staleRefresh, row.accessToken]);
  } catch (e) {
    throw new Error(`Could not refresh the Grok subscription. ${(e as Error).message}`.slice(0, 300));
  }
  if (!result.ok) {
    const error = String(result.json.error || '');
    if (error === 'invalid_grant') {
      deleteSetting(GROK_OAUTH_KEY);
      return null;
    }
    const detail = typeof result.json.error_description === 'string' ? result.json.error_description : error || `HTTP ${result.status}`;
    throw new Error(redact(`Could not refresh the Grok subscription. ${detail}`, staleRefresh, row.accessToken).slice(0, 300));
  }
  saveTokenResponse(result.json, row.email);
  return readGrok()?.accessToken ?? null;
}

/** Current subscription access token, refreshing and rotating when it is near expiry. */
export function getGrokAccessToken(): Promise<string | null> {
  const row = readGrok();
  if (!row?.refreshToken) return Promise.resolve(null);
  if (row.accessToken && row.expiresAt - Date.now() > 60_000) return Promise.resolve(row.accessToken);
  if (!refreshing) {
    refreshing = refreshGrok(row).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function currentGrokClientVersion(): Promise<string> {
  if (grokVersionFetchedAt && Date.now() - grokVersionFetchedAt < 12 * 60 * 60 * 1000) return grokClientVersion;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    timer.unref?.();
    const res = await fetch(GROK_VERSION_URL, { redirect: 'error', signal: ctrl.signal, cache: 'no-store' });
    const text = (await res.text()).trim();
    if (res.ok && /^\d+\.\d+\.\d+$/.test(text)) grokClientVersion = text;
  } catch {
    /* keep the last known Grok CLI version */
  }
  grokVersionFetchedAt = Date.now();
  return grokClientVersion;
}

export async function grokProxyHeaders(model: string, accessToken: string): Promise<Record<string, string>> {
  const version = await currentGrokClientVersion();
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-client-identifier': 'grok-shell',
    'x-grok-client-version': version,
    'x-grok-model-override': model,
  };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

export function startCursorSignIn(): AiSubscriptionView {
  clearCursorTimer();
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const uuid = randomUUID();
  const loginUrl = `${CURSOR_WEB}/loginDeepControl?challenge=${encodeURIComponent(challenge)}&uuid=${encodeURIComponent(uuid)}&mode=login&redirectTarget=sdk`;
  const gen = ++cursorGen;
  cursorPending = {
    gen,
    uuid,
    verifier,
    loginUrl,
    expiresAt: Date.now() + 20 * 60 * 1000,
    delayMs: 1_000,
    failures: 0,
    status: 'pending',
  };
  armCursor(gen, 0);
  return cursorView();
}

function armCursor(gen: number, delay: number) {
  if (!autoPoll || !cursorPending || cursorPending.gen !== gen) return;
  const timer = setTimeout(() => {
    void stepCursor(gen);
  }, delay);
  timer.unref?.();
  cursorPending.timer = timer;
}

async function stepCursor(gen: number) {
  if (!cursorPending || cursorPending.gen !== gen || cursorPending.status !== 'pending') return;
  if (Date.now() >= cursorPending.expiresAt) {
    cursorPending.status = 'error';
    cursorPending.message = 'Cursor sign-in timed out. Start again.';
    cursorPending.verifier = '';
    return;
  }
  const delay = cursorPending.delayMs;
  await pollCursorSignInOnce();
  if (cursorPending && cursorPending.gen === gen && cursorPending.status === 'pending') {
    cursorPending.delayMs = Math.min(10_000, Math.round(delay * 1.2));
    armCursor(gen, cursorPending.delayMs);
  }
}

async function cursorJson(url: string, body: unknown, accessToken: string | null): Promise<{ ok: boolean; status: number; text: string }> {
  const allowed = url === `${CURSOR_API}/auth/poll`
    || url === `${CURSOR_API}/aiserver.v1.DashboardService/CreateUserApiKey`
    || url === `${CURSOR_API}/aiserver.v1.DashboardService/GetMe`;
  if (!allowed) throw new Error('Refusing to call an unexpected Cursor auth host');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  timer.unref?.();
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal: ctrl.signal,
      cache: 'no-store',
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export async function pollCursorSignInOnce(): Promise<AiSubscriptionView> {
  const pending = cursorPending;
  if (!pending || pending.status !== 'pending') return cursorView();
  let polled: { ok: boolean; status: number; text: string };
  try {
    polled = await cursorJson(`${CURSOR_API}/auth/poll`, { uuid: pending.uuid, verifier: pending.verifier }, null);
  } catch (e) {
    pending.failures += 1;
    if (pending.failures >= 3) {
      pending.status = 'error';
      pending.message = redact((e as Error).message || 'Cursor sign-in failed', pending.verifier).slice(0, 300);
      pending.verifier = '';
    }
    return cursorView();
  }
  if (polled.status === 404) {
    const text = polled.text.trim();
    if (text === 'Not found') return cursorView();
    pending.status = 'error';
    pending.message = 'Cursor sign-in polling is unavailable. Paste an API key from the Cursor dashboard.';
    pending.verifier = '';
    return cursorView();
  }
  if (!polled.ok) {
    pending.failures += 1;
    if (pending.failures >= 3) {
      pending.status = 'error';
      pending.message = 'Cursor sign-in failed before it finished.';
      pending.verifier = '';
    }
    return cursorView();
  }
  let accessToken = '';
  try {
    const json = JSON.parse(polled.text) as { accessToken?: unknown };
    if (typeof json.accessToken === 'string') accessToken = json.accessToken;
  } catch {
    accessToken = '';
  }
  if (!accessToken) {
    pending.status = 'error';
    pending.message = 'Cursor sign-in returned an unexpected response.';
    pending.verifier = '';
    return cursorView();
  }
  try {
    const minted = await mintCursorKey(accessToken);
    const expiresAtMs = Date.now() + CURSOR_KEY_TTL_MS;
    setSetting('ai.apiKey.cursor', minted.apiKey);
    setSetting(CURSOR_OAUTH_KEY, JSON.stringify({
      via: 'subscription',
      email: minted.email,
      expiresAt: new Date(expiresAtMs).toISOString(),
    } satisfies CursorRecord));
    cursorPending = null;
  } catch (e) {
    pending.status = 'error';
    pending.message = redact((e as Error).message || 'Cursor could not mint an API key', accessToken, pending.verifier).slice(0, 300);
    pending.verifier = '';
  }
  return cursorView();
}

async function mintCursorKey(accessToken: string): Promise<{ apiKey: string; email: string | null }> {
  const expiresAt = String(Date.now() + CURSOR_KEY_TTL_MS);
  const created = await cursorJson(
    `${CURSOR_API}/aiserver.v1.DashboardService/CreateUserApiKey`,
    { name: CURSOR_KEY_NAME, expiresAt },
    accessToken,
  );
  if (!created.ok) {
    let detail = `HTTP ${created.status}`;
    try {
      const json = JSON.parse(created.text) as { message?: unknown };
      if (typeof json.message === 'string' && json.message) detail = json.message;
    } catch {
      /* keep the status */
    }
    throw new Error(redact(
      `Cursor sign-in succeeded, but creating an API key failed: ${detail}. A team policy can block user API keys. Paste a key from the Cursor dashboard.`,
      accessToken,
    ));
  }
  let apiKey = '';
  try {
    const json = JSON.parse(created.text) as { apiKey?: unknown; api_key?: unknown };
    if (typeof json.apiKey === 'string') apiKey = json.apiKey;
    else if (typeof json.api_key === 'string') apiKey = json.api_key;
  } catch {
    apiKey = '';
  }
  if (!apiKey) throw new Error('Cursor sign-in succeeded, but the server returned an empty API key.');
  let email: string | null = null;
  try {
    const me = await cursorJson(`${CURSOR_API}/aiserver.v1.DashboardService/GetMe`, {}, accessToken);
    if (me.ok) {
      const json = JSON.parse(me.text) as { email?: unknown };
      if (typeof json.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(json.email)) email = json.email;
    }
  } catch {
    email = null;
  }
  return { apiKey, email };
}

export function cursorSignInStatus(): AiSubscriptionView {
  return cursorView();
}

export function cancelCursorSignIn(): AiSubscriptionView {
  clearCursorTimer();
  cursorGen += 1;
  cursorPending = null;
  return cursorView();
}

export function disconnectCursor(): AiSubscriptionView {
  clearCursorTimer();
  cursorGen += 1;
  cursorPending = null;
  if (readCursor()) deleteSetting('ai.apiKey.cursor');
  deleteSetting(CURSOR_OAUTH_KEY);
  return cursorView();
}

export function setSubscriptionAutoPollForTests(on: boolean) {
  autoPoll = on;
}

export function pinGrokClientVersionForTests(version: string) {
  grokClientVersion = version;
  grokVersionFetchedAt = Date.now();
}

export function resetSubscriptionStateForTests() {
  clearGrokTimer();
  clearCursorTimer();
  grokGen += 1;
  cursorGen += 1;
  grokPending = null;
  cursorPending = null;
  refreshing = null;
  autoPoll = true;
  grokClientVersion = GROK_VERSION_FALLBACK;
  grokVersionFetchedAt = 0;
}
