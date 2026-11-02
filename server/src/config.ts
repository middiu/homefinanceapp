import 'dotenv/config';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === 'true' || v === '1' || v === 'yes';
}

function parseAiProvider(v: string | undefined): 'ollama' | 'grok' | 'cursor' {
  if (v === 'grok' || v === 'cursor' || v === 'ollama') return v;
  return 'ollama';
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || './data/homefinance.sqlite',
  clientDist: process.env.CLIENT_DIST || './client/dist',
  ai: {
    enabled: bool(process.env.AI_ENABLED, true),
    provider: parseAiProvider(process.env.AI_PROVIDER),
    baseUrl: process.env.AI_BASE_URL || 'https://ollama.com/v1',
    // AI_API_KEY applies only to AI_PROVIDER (default ollama). It is never reused
    // as the Grok or Cursor key, so switching provider cannot leak the other secret.
    apiKey: process.env.AI_API_KEY || '',
    grokApiKey: process.env.AI_GROK_API_KEY || '',
    cursorApiKey: process.env.AI_CURSOR_API_KEY || '',
    model: process.env.AI_MODEL || '',
    digestCron: process.env.AI_DIGEST_CRON || '0 7 * * 1',
  },
  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    cron: process.env.BACKUP_CRON || '0 3 * * *',
    keep: parseInt(process.env.BACKUP_KEEP || '14', 10),
  },
  auth: {
    adminInitialPassword: process.env.ADMIN_INITIAL_PASSWORD || 'Pa$$word!',
    sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10), // 7d sliding
    cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
    maxFailedAttempts: parseInt(process.env.AUTH_MAX_FAILS || '5', 10),
    lockoutBaseMs: parseInt(process.env.AUTH_LOCKOUT_MS || String(5 * 60 * 1000), 10), // 5min, grows
  },
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) : false,
};