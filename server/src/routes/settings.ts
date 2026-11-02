import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AiConfigError, applyAiConfig, readAiConfig } from '../services/aiProvider.js';
import {
  cancelCursorSignIn,
  cancelGrokSignIn,
  cursorSignInStatus,
  disconnectCursor,
  disconnectGrok,
  grokSignInStatus,
  startCursorSignIn,
  startGrokSignIn,
} from '../services/aiSubscription.js';

const router = Router();

const signInLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many sign-in attempts, try again later' },
});

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

router.get('/ai/subscription/grok', (_req, res) => {
  res.json(grokSignInStatus());
});

router.post('/ai/subscription/grok/start', signInLimiter, async (_req, res) => {
  try {
    res.json(await startGrokSignIn());
  } catch (e) {
    res.status(502).json({ status: 'error', message: (e as Error).message || 'Grok sign-in failed' });
  }
});

router.post('/ai/subscription/grok/cancel', (_req, res) => {
  res.json(cancelGrokSignIn());
});

router.delete('/ai/subscription/grok', (_req, res) => {
  res.json(disconnectGrok());
});

router.get('/ai/subscription/cursor', (_req, res) => {
  res.json(cursorSignInStatus());
});

router.post('/ai/subscription/cursor/start', signInLimiter, (_req, res) => {
  res.json(startCursorSignIn());
});

router.post('/ai/subscription/cursor/cancel', (_req, res) => {
  res.json(cancelCursorSignIn());
});

router.delete('/ai/subscription/cursor', (_req, res) => {
  res.json(disconnectCursor());
});

export default router;