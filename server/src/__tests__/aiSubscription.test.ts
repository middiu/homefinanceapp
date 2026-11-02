import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupDb, getDb, schema } from './dbHelper.js';
import { applyAiConfig, chat, readAiConfig, testConnection } from '../services/aiProvider.js';
import {
  cancelGrokSignIn,
  cursorSignInStatus,
  disconnectCursor,
  disconnectGrok,
  getGrokAccessToken,
  grokSignInStatus,
  pinGrokClientVersionForTests,
  pollCursorSignInOnce,
  pollGrokSignInOnce,
  resetSubscriptionStateForTests,
  setSubscriptionAutoPollForTests,
  startCursorSignIn,
  startGrokSignIn,
} from '../services/aiSubscription.js';

const DEVICE = 'grok-device-secret-value';
const ACCESS = 'grok-access-secret-value';
const REFRESH = 'grok-refresh-secret-value';
const SESSION = 'cursor-session-access-value';
const SESSION_REFRESH = 'cursor-session-refresh-value';
const MINTED = 'cursor-minted-key-value';

beforeAll(() => {
  setupDb();
});

beforeEach(() => {
  setSubscriptionAutoPollForTests(false);
  pinGrokClientVersionForTests('1.0.70');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetSubscriptionStateForTests();
  const db = getDb();
  for (const key of ['ai.oauth.grok', 'ai.oauth.cursor', 'ai.apiKey.grok', 'ai.apiKey.cursor']) {
    db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
  }
});

function emailToken(email: string): string {
  return `hdr.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`;
}

function setting(key: string): string | null {
  return getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value ?? null;
}

describe('Grok subscription sign-in', () => {
  it('returns the user code and keeps the device code on the server', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toBe('https://auth.x.ai/oauth2/device/code');
      return new Response(JSON.stringify({
        device_code: DEVICE,
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.x.ai/oauth2/device',
        verification_uri_complete: 'https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH',
        expires_in: 1800,
        interval: 5,
      }), { status: 200 });
    }));
    const view = await startGrokSignIn();
    expect(view.status).toBe('pending');
    expect(view.userCode).toBe('ABCD-EFGH');
    expect(view.verificationUriComplete).toContain('https://accounts.x.ai/');
    expect(JSON.stringify(view)).not.toContain(DEVICE);
    expect(JSON.stringify(grokSignInStatus())).not.toContain(DEVICE);
  });

  it('stores rotated tokens server-side and omits them from settings reads', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push(String(url));
      if (String(url).endsWith('/device/code')) {
        return new Response(JSON.stringify({
          device_code: DEVICE,
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://accounts.x.ai/oauth2/device',
          verification_uri_complete: 'https://evil.example/phish',
          expires_in: 1800,
          interval: 5,
        }), { status: 200 });
      }
      const body = String(init.body || '');
      if (body.includes('device_code')) {
        expect(body).toContain(DEVICE);
        return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
      }
      return new Response('unexpected', { status: 500 });
    }));
    await startGrokSignIn();
    const pending = await pollGrokSignInOnce();
    expect(pending.status).toBe('pending');
    expect(pending.verificationUriComplete).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: ACCESS,
      refresh_token: REFRESH,
      expires_in: 3600,
      id_token: emailToken('ada@example.com'),
    }), { status: 200 })));
    const done = await pollGrokSignInOnce();
    expect(done.status).toBe('connected');
    expect(done.email).toBe('ada@example.com');
    applyAiConfig({ provider: 'grok', model: 'grok-4.7' });
    expect(JSON.stringify(done)).not.toContain(ACCESS);
    expect(JSON.stringify(done)).not.toContain(REFRESH);
    expect(JSON.stringify(readAiConfig())).not.toContain(ACCESS);
    expect(JSON.stringify(readAiConfig())).not.toContain(REFRESH);
    expect(readAiConfig().subscription.grok.connected).toBe(true);
    expect(readAiConfig().endpoint).toBe('https://cli-chat-proxy.grok.com');
    expect(setting('ai.oauth.grok')).toContain(REFRESH);

    const stored = JSON.parse(setting('ai.oauth.grok') || '{}');
    stored.expiresAt = 0;
    getDb().update(schema.settings).set({ value: JSON.stringify(stored) }).where(eq(schema.settings.key, 'ai.oauth.grok')).run();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      expect(String(url)).toBe('https://auth.x.ai/oauth2/token');
      expect(String(init.body)).toContain(REFRESH);
      return new Response(JSON.stringify({
        access_token: 'grok-access-rotated-value',
        refresh_token: 'grok-refresh-rotated-value',
        expires_in: 3600,
      }), { status: 200 });
    }));
    await expect(getGrokAccessToken()).resolves.toBe('grok-access-rotated-value');
    expect(setting('ai.oauth.grok')).toContain('grok-refresh-rotated-value');
    expect(setting('ai.oauth.grok')).not.toContain(REFRESH);
  });

  it('drops the subscription when refresh is rejected', async () => {
    getDb().insert(schema.settings).values({
      key: 'ai.oauth.grok',
      value: JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: 0, email: null }),
    }).run();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(getGrokAccessToken()).resolves.toBeNull();
    expect(setting('ai.oauth.grok')).toBeNull();
    expect(grokSignInStatus().status).toBe('idle');
  });

  it('uses the subscription for Grok calls and keeps a pasted key on api.x.ai', async () => {
    getDb().insert(schema.settings).values({
      key: 'ai.oauth.grok',
      value: JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: Date.now() + 60 * 60 * 1000, email: 'ada@example.com' }),
    }).run();
    applyAiConfig({ provider: 'grok', apiKey: 'xai-secret-value-222', model: 'grok-4.7', enabled: true });
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      urls.push(String(url));
      const headers = init.headers as Record<string, string>;
      if (String(url).includes('cli-chat-proxy.grok.com')) {
        expect(headers.Authorization).toBe(`Bearer ${ACCESS}`);
        expect(headers.Authorization).not.toContain('xai-secret-value-222');
        return new Response(JSON.stringify({ output_text: 'ok' }), { status: 200 });
      }
      expect(headers.Authorization).toBe('Bearer xai-pasted-value-333');
      expect(String(url)).toBe('https://api.x.ai/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'grok-4.7' }] }), { status: 200 });
    }));
    await expect(chat('Say hi')).resolves.toBe('ok');
    expect(urls).toEqual(['https://cli-chat-proxy.grok.com/v1/responses']);
    const tested = await testConnection({ provider: 'grok', apiKey: 'xai-pasted-value-333', baseUrl: 'https://evil.example' });
    expect(tested.ok).toBe(true);
    expect(urls[1]).toBe('https://api.x.ai/v1/models');
    expect(JSON.stringify(tested)).not.toContain('xai-pasted-value-333');
    disconnectGrok();
    expect(readAiConfig().subscription.grok.connected).toBe(false);
    expect(readAiConfig().keysConfigured.grok).toBe(true);
    cancelGrokSignIn();
  });
});

describe('Cursor subscription sign-in', () => {
  it('polls with the verifier in the body and stores only the minted key', async () => {
    const started = startCursorSignIn();
    expect(started.status).toBe('pending');
    expect(started.loginUrl).toContain('https://cursor.com/loginDeepControl?');
    expect(started.loginUrl).not.toContain('verifier');

    let verifier = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      if (href.endsWith('/auth/poll')) {
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body));
        verifier = body.verifier;
        expect(href).not.toContain(body.verifier);
        return new Response('Not found', { status: 404 });
      }
      return new Response('unexpected', { status: 500 });
    }));
    const pending = await pollCursorSignInOnce();
    expect(pending.status).toBe('pending');
    expect(verifier.length).toBeGreaterThan(20);
    expect(JSON.stringify(pending)).not.toContain(verifier);
    expect(JSON.stringify(cursorSignInStatus())).not.toContain(verifier);

    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const href = String(url);
      if (href.endsWith('/auth/poll')) {
        return new Response(JSON.stringify({ accessToken: SESSION, refreshToken: SESSION_REFRESH }), { status: 200 });
      }
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${SESSION}`);
      if (href.endsWith('/CreateUserApiKey')) {
        const body = JSON.parse(String(init.body));
        expect(body.name).toBe('HomeFinance');
        return new Response(JSON.stringify({ apiKey: MINTED }), { status: 200 });
      }
      if (href.endsWith('/GetMe')) return new Response(JSON.stringify({ email: 'ada@example.com' }), { status: 200 });
      return new Response('unexpected', { status: 500 });
    }));
    const done = await pollCursorSignInOnce();
    expect(done.status).toBe('connected');
    expect(done.email).toBe('ada@example.com');
    const leaked = JSON.stringify({ done, config: readAiConfig(), status: cursorSignInStatus() });
    expect(leaked).not.toContain(SESSION);
    expect(leaked).not.toContain(SESSION_REFRESH);
    expect(leaked).not.toContain(verifier);
    expect(leaked).not.toContain(MINTED);
    expect(setting('ai.apiKey.cursor')).toBe(MINTED);
    expect(setting('ai.oauth.cursor')).not.toContain(MINTED);
    expect(setting('ai.oauth.cursor')).not.toContain(SESSION);

    applyAiConfig({ provider: 'cursor', apiKey: 'cursor-manual-value-444' });
    expect(readAiConfig().subscription.cursor.connected).toBe(false);
    disconnectCursor();
    expect(setting('ai.apiKey.cursor')).toBe('cursor-manual-value-444');

    getDb().insert(schema.settings).values({
      key: 'ai.oauth.cursor',
      value: JSON.stringify({ via: 'subscription', email: 'ada@example.com', expiresAt: new Date().toISOString() }),
    }).run();
    disconnectCursor();
    expect(setting('ai.apiKey.cursor')).toBeNull();
    expect(cursorSignInStatus().status).toBe('idle');
  });
});
