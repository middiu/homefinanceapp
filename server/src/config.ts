import 'dotenv/config';

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  return v === 'true' || v === '1' || v === 'yes';
}

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  databaseUrl: process.env.DATABASE_URL || './data/homefinance.sqlite',
  clientDist: process.env.CLIENT_DIST || './client/dist',
  ai: {
    enabled: bool(process.env.AI_ENABLED, true),
    baseUrl: process.env.AI_BASE_URL || 'https://ollama.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'llama3.1',
    digestCron: process.env.AI_DIGEST_CRON || '0 7 * * 1',
  },
  backup: {
    dir: process.env.BACKUP_DIR || './backups',
    cron: process.env.BACKUP_CRON || '0 3 * * *',
    keep: parseInt(process.env.BACKUP_KEEP || '14', 10),
  },
};