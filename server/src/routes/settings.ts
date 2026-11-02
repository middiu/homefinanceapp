import { Router } from 'express';
import { z } from 'zod';
import { AiConfigError, applyAiConfig, readAiConfig } from '../services/aiProvider.js';

const router = Router();

// AI config (key never returned to client).
router.get('/ai', (_req, res) => {
  res.json(readAiConfig());
});

const aiConfigSchema = z.object({
  provider: z.enum(['ollama', 'grok', 'cursor']).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(128).optional(),
  apiKey: z.string().max(2000).optional(), // empty string => clear that provider's key
  digestCron: z.string().max(100).optional(),
  autoCategorize: z.boolean().optional(),
});

router.put('/ai', (req, res) => {
  const parsed = aiConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    applyAiConfig(parsed.data);
  } catch (e) {
    if (e instanceof AiConfigError) return res.status(400).json({ error: e.message });
    throw e;
  }
  res.json({ ok: true });
});

export default router;