import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import type { AiConfigDto } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

function getSetting(key: string): string | null {
  const r = db().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return r ? r.value : null;
}
function setSetting(key: string, value: string) {
  const d = db();
  const existing = d.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (existing) d.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  else d.insert(schema.settings).values({ key, value }).run();
}

// AI config (key never returned to client).
router.get('/ai', (_req, res) => {
  const hasKey = !!(getSetting('ai.apiKey') || config.ai.apiKey);
  const dto: AiConfigDto = {
    enabled: getSetting('ai.enabled') !== 'false' && config.ai.enabled,
    baseUrl: getSetting('ai.baseUrl') || config.ai.baseUrl,
    model: getSetting('ai.model') || config.ai.model,
    hasApiKey: hasKey,
    digestCron: getSetting('ai.digestCron') || config.ai.digestCron,
    // auto-categorize defaults ON if a key is configured, else OFF (Phase 2 §3.2).
    autoCategorize: getSetting('ai.autoCategorize') !== null ? getSetting('ai.autoCategorize') === 'true' : hasKey,
  };
  res.json(dto);
});

const aiConfigSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(), // empty string => clear
  digestCron: z.string().optional(),
  autoCategorize: z.boolean().optional(),
});

router.put('/ai', (req, res) => {
  const parsed = aiConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.enabled !== undefined) setSetting('ai.enabled', String(parsed.data.enabled));
  if (parsed.data.baseUrl !== undefined) setSetting('ai.baseUrl', parsed.data.baseUrl);
  if (parsed.data.model !== undefined) setSetting('ai.model', parsed.data.model);
  if (parsed.data.apiKey !== undefined) setSetting('ai.apiKey', parsed.data.apiKey);
  if (parsed.data.digestCron !== undefined) setSetting('ai.digestCron', parsed.data.digestCron);
  if (parsed.data.autoCategorize !== undefined) setSetting('ai.autoCategorize', String(parsed.data.autoCategorize));
  res.json({ ok: true });
});

export default router;