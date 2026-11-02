import { beforeAll, describe, expect, it, vi, afterEach } from 'vitest';
import { setupDb, getDb, schema } from './dbHelper.js';
import { eq } from 'drizzle-orm';
import {
  applyAiConfig,
  assertOllamaBaseUrl,
  isAllowedOllamaRequest,
  buildCursorRunBody,
  buildGrokChatBody,
  buildGrokWebSearchBody,
  cursorModelIds,
  extractGrokText,
  filterGrokModelIds,
  interpretCursorRun,
  isSafeModelId,
  readAiConfig,
  redactSecrets,
  runProviderChat,
  testConnection,
} from '../services/aiProvider.js';

beforeAll(() => {
  setupDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function putSetting(key: string, value: string) {
  const db = getDb();
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (existing) db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  else db.insert(schema.settings).values({ key, value }).run();
}

describe('ollama base URL', () => {
  it('allows localhost and strips secrets from the query', () => {
    expect(assertOllamaBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(assertOllamaBaseUrl('https://ollama.com/v1?token=secret')).toBe('https://ollama.com/v1');
  });

  it('lets chat stay on the configured host and merchant search stay on ollama.com', () => {
    expect(isAllowedOllamaRequest('http://localhost:11434', 'http://localhost:11434/api/chat')).toBe(true);
    expect(isAllowedOllamaRequest('http://localhost:11434', 'https://ollama.com/api/web_search')).toBe(true);
    expect(isAllowedOllamaRequest('http://localhost:11434', 'https://evil.example/api/chat')).toBe(false);
    expect(isAllowedOllamaRequest('https://ollama.com', 'https://ollama.com/api/web_fetch')).toBe(true);
    expect(isAllowedOllamaRequest('https://ollama.com', 'http://169.254.169.254/latest')).toBe(false);
  });

  it('rejects metadata hosts, credentialed URLs, and non-http schemes', () => {
    expect(() => assertOllamaBaseUrl('http://169.254.169.254/latest')).toThrow(/not allowed/);
    expect(() => assertOllamaBaseUrl('http://metadata.google.internal/')).toThrow(/not allowed/);
    expect(() => assertOllamaBaseUrl('http://user:pass@ollama.com')).toThrow(/credentials/);
    expect(() => assertOllamaBaseUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => assertOllamaBaseUrl('not a url')).toThrow(/absolute/);
  });
});

describe('model ids and response parsers', () => {
  it('accepts provider model ids and rejects path or whitespace characters', () => {
    expect(isSafeModelId('grok-4.7')).toBe(true);
    expect(isSafeModelId('llama3.1:70b')).toBe(true);
    expect(isSafeModelId('composer-2.5')).toBe(true);
    expect(isSafeModelId('bad model')).toBe(false);
    expect(isSafeModelId('../etc/passwd')).toBe(false);
    expect(isSafeModelId('')).toBe(false);
  });

  it('keeps Grok text models and drops image, video, and embedding ids', () => {
    expect(filterGrokModelIds(['grok-4.7', 'grok-4', 'grok-imagine-image', 'embed-1', 'other-model'])).toEqual(['grok-4.7', 'grok-4']);
  });

  it('reads Cursor catalogue ids', () => {
    expect(cursorModelIds({ items: [{ id: 'grok-4.7' }, { id: 'composer-2.5' }, { id: 'bad id' }] })).toEqual(['grok-4.7', 'composer-2.5']);
  });

  it('extracts text from Responses and Chat Completions payloads', () => {
    expect(extractGrokText({ output_text: '  hello ' })).toBe('hello');
    expect(extractGrokText({
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Groceries' }] }],
    })).toBe('Groceries');
    expect(extractGrokText({ choices: [{ message: { content: 'Income' } }] })).toBe('Income');
  });

  it('builds a Cursor run with no repo, MCP, env, or images', () => {
    const body = buildCursorRunBody('1. "COLES" (amount: -12 AUD)', 'Reply only with the list.', 'grok-4.7', 'chat');
    expect(Object.keys(body).sort()).toEqual(['autoCreatePR', 'mode', 'model', 'name', 'prompt']);
    expect(body.mode).toBe('plan');
    expect(body.autoCreatePR).toBe(false);
    expect(body.name).toBe('HomeFinance');
    expect(body.model).toEqual({ id: 'grok-4.7' });
    expect(body.prompt.text).toContain('Do not use tools');
    expect(body.prompt.text).toContain('COLES');
    expect(JSON.stringify(body)).not.toMatch(/repos|mcpServers|envVars|images|subagents/i);
  });

  it('asks Grok for web search without image search or X search', () => {
    const body = buildGrokWebSearchBody('grok-4.7', 'woolworths merchant shop australia');
    expect(body.tools).toEqual([{ type: 'web_search', enable_image_search: false, enable_image_understanding: false }]);
    expect(JSON.stringify(body)).not.toMatch(/x_search|enable_image_search":true/);
    const chat = buildGrokChatBody('grok-4.7', 'totals', 'advisor');
    expect(chat).not.toHaveProperty('tools');
    expect(chat.input[0]).toEqual({ role: 'system', content: 'advisor' });
  });

  it('interprets Cursor run statuses', () => {
    expect(interpretCursorRun({ status: 'RUNNING' }).state).toBe('pending');
    expect(interpretCursorRun({ status: 'FINISHED', result: '  1|Groceries ' })).toEqual({ state: 'ok', text: '1|Groceries' });
    expect(interpretCursorRun({ status: 'ERROR', result: 'boom' }).state).toBe('failed');
  });

  it('redacts bearer tokens and the configured key', () => {
    const msg = redactSecrets('Bearer xai-secret-value-123456 failed for xai-secret-value-123456', 'xai-secret-value-123456');
    expect(msg).not.toContain('xai-secret-value-123456');
    expect(msg).toContain('[redacted]');
  });
});

describe('provider settings', () => {
  it('stores a separate key per provider and never returns it', () => {
    applyAiConfig({ provider: 'ollama', apiKey: 'ollama-secret-value-111', baseUrl: 'https://ollama.com/v1', model: 'llama3.1' });
    applyAiConfig({ provider: 'grok', apiKey: 'xai-secret-value-222', model: 'grok-4.7' });
    applyAiConfig({ provider: 'cursor', apiKey: 'cursor-secret-value-333', model: 'composer-2.5' });

    const dto = readAiConfig();
    expect(dto.provider).toBe('cursor');
    expect(dto.endpoint).toBe('https://api.cursor.com');
    expect(dto.hasApiKey).toBe(true);
    expect(dto.keysConfigured).toEqual({ ollama: true, grok: true, cursor: true });
    expect(dto.baseUrl).toBe('https://ollama.com/v1');
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain('ollama-secret-value-111');
    expect(serialized).not.toContain('xai-secret-value-222');
    expect(serialized).not.toContain('cursor-secret-value-333');
  });

  it('does not reuse the legacy Ollama key when Grok is selected', () => {
    putSetting('ai.provider', 'grok');
    putSetting('ai.apiKey', 'legacy-ollama-secret-999');
    putSetting('ai.apiKey.grok', '');
    putSetting('ai.apiKey.ollama', '');
    const dto = readAiConfig();
    expect(dto.provider).toBe('grok');
    expect(dto.hasApiKey).toBe(false);
    expect(dto.keysConfigured.ollama).toBe(true);
    expect(dto.keysConfigured.grok).toBe(false);
  });

  it('replaces a Cursor model id when switching to Grok, even if the client sends it', () => {
    applyAiConfig({ provider: 'cursor', model: 'composer-2.5' });
    applyAiConfig({ provider: 'grok', model: 'composer-2.5' });
    expect(readAiConfig().model).toBe('grok-4.7');
    applyAiConfig({ provider: 'grok', model: 'grok-4' });
    applyAiConfig({ provider: 'cursor' });
    expect(readAiConfig().model).toBe('grok-4');
    applyAiConfig({ provider: 'grok', model: 'composer-2.5' });
    expect(readAiConfig().provider).toBe('grok');
    expect(readAiConfig().model).toBe('grok-4.7');
  });

  it('ignores a Grok base URL override and keeps the saved Ollama host', () => {
    applyAiConfig({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3.1' });
    applyAiConfig({ provider: 'grok', baseUrl: 'https://evil.example/steal' });
    const dto = readAiConfig();
    expect(dto.provider).toBe('grok');
    expect(dto.baseUrl).toBe('http://localhost:11434');
    expect(dto.endpoint).toBe('https://api.x.ai');
    expect(dto.model).toBe('grok-4.7');
  });

  it('rejects a metadata Ollama URL and an unsafe model id', () => {
    expect(() => applyAiConfig({ provider: 'ollama', baseUrl: 'http://169.254.169.254/latest' })).toThrow(/not allowed/);
    expect(() => applyAiConfig({ model: 'grok 4' })).toThrow(/unsupported characters/);
    expect(readAiConfig().baseUrl).toBe('http://localhost:11434');
  });

  it('clears only the active provider key', () => {
    applyAiConfig({ provider: 'cursor', apiKey: 'cursor-secret-value-333' });
    applyAiConfig({ provider: 'grok', apiKey: 'xai-secret-value-222' });
    applyAiConfig({ provider: 'grok', apiKey: '' });
    const dto = readAiConfig();
    expect(dto.provider).toBe('grok');
    expect(dto.keysConfigured.grok).toBe(false);
    expect(dto.keysConfigured.cursor).toBe(true);
    expect(dto.keysConfigured.ollama).toBe(true);
  });
});

describe('pinned provider calls', () => {
  it('sends Grok chat only to api.x.ai and redacts the key from errors', async () => {
    const secret = 'xai-secret-value-222';
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.x.ai/v1/responses');
      expect(init.redirect).toBe('error');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('grok-4.7');
      expect(body.tools).toBeUndefined();
      return new Response(JSON.stringify({ error: { message: `rejected ${secret}` } }), { status: 401 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(runProviderChat(
      { provider: 'grok', baseUrl: 'https://evil.example', apiKey: secret, model: 'grok-4.7' },
      'Say hi',
      'advisor',
    )).rejects.toThrow(/\[redacted\]/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads a Grok Responses payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '1|Groceries' }] }],
    }), { status: 200 })));
    const text = await runProviderChat(
      { provider: 'grok', baseUrl: 'https://evil.example', apiKey: 'xai-secret-value-222', model: 'grok-4.7' },
      'categorize',
    );
    expect(text).toBe('1|Groceries');
  });

  it('creates a no-repo Cursor agent, reads the reply, and deletes the agent', async () => {
    const secret = 'cursor-secret-value-333';
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? String(init.body) : undefined });
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${secret}`);
      if (String(url).endsWith('/v1/agents') && init.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.repos).toBeUndefined();
        expect(body.mcpServers).toBeUndefined();
        expect(body.env).toBeUndefined();
        expect(body.envVars).toBeUndefined();
        expect(body.mode).toBe('plan');
        expect(body.autoCreatePR).toBe(false);
        return new Response(JSON.stringify({
          agent: { id: 'bc-test-agent' },
          run: { id: 'run-test-run' },
        }), { status: 200 });
      }
      if (String(url).includes('/runs/run-test-run') && !String(url).endsWith('/cancel')) {
        return new Response(JSON.stringify({ status: 'FINISHED', result: '1|Groceries' }), { status: 200 });
      }
      if (init.method === 'DELETE') {
        return new Response(JSON.stringify({ id: 'bc-test-agent' }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }));

    const text = await runProviderChat(
      { provider: 'cursor', baseUrl: 'https://evil.example', apiKey: secret, model: 'composer-2.5' },
      '1. "COLES"',
    );
    expect(text).toBe('1|Groceries');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.cursor.com/v1/agents',
      'GET https://api.cursor.com/v1/agents/bc-test-agent/runs/run-test-run',
      'DELETE https://api.cursor.com/v1/agents/bc-test-agent',
    ]);
  });

  it('still deletes the Cursor agent when the run fails', async () => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      methods.push(`${init.method || 'GET'} ${url}`);
      if (init.method === 'POST') {
        return new Response(JSON.stringify({ agent: { id: 'bc-fail' }, run: { id: 'run-fail' } }), { status: 200 });
      }
      if (init.method === 'DELETE') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ status: 'ERROR', result: 'nope' }), { status: 200 });
    }));
    await expect(runProviderChat(
      { provider: 'cursor', baseUrl: 'https://api.cursor.com', apiKey: 'cursor-secret-value-333', model: 'grok-4.7' },
      'hello',
    )).rejects.toThrow(/failed/i);
    expect(methods.some((m) => m.startsWith('DELETE https://api.cursor.com/v1/agents/bc-fail'))).toBe(true);
  });

  it('refuses to send a stored Ollama key to a different host', async () => {
    applyAiConfig({ provider: 'ollama', baseUrl: 'https://ollama.com/v1', apiKey: 'ollama-secret-value-111', model: 'llama3.1' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await testConnection({ provider: 'ollama', baseUrl: 'http://127.0.0.1:9' });
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('auth');
    expect(result.message).toMatch(/stored key/i);
    expect(result.message).not.toContain('ollama-secret-value-111');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tests Grok against api.x.ai even if the client sends another base URL', async () => {
    applyAiConfig({ provider: 'grok', apiKey: 'xai-secret-value-222', model: 'grok-4.7' });
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://api.x.ai/v1/models');
      return new Response(JSON.stringify({ data: [{ id: 'grok-4.7' }, { id: 'grok-imagine-image' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await testConnection({ provider: 'grok', baseUrl: 'https://evil.example', model: 'grok-4.7' });
    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['grok-4.7']);
    expect(result.message).not.toContain('xai-secret-value-222');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
