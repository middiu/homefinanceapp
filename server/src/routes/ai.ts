import { Router } from 'express';
import { z } from 'zod';
import {
  generateInsight,
  generateForecast,
  detectAnomalies,
  detectSubscriptions,
  latestInsight,
  isAiEnabled,
  getProvider,
  listCloudModels,
  testConnection,
  testHistory,
  buildForecastReport,
} from '../services/ai.js';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { InsightType, RuleMatchType } from '@homefinance/shared';

const router = Router();

// On-demand insight for a scope (household | member:<id> | account:<id>)
router.post('/insight', async (req, res) => {
  const scope = (req.body.scope as string) || 'household';
  try {
    const r = await generateInsight(scope);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

router.get('/insight/latest', (req, res) => {
  const scope = (req.query.scope as string) || 'household';
  res.json(latestInsight(scope) || null);
});

router.post('/forecast', async (req, res) => {
  const scope = (req.body.scope as string) || 'household';
  try {
    const r = await generateForecast(scope);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

// Phase 2 §8 — full 12-month forecast report (statistical + recurring + AI narrative).
router.post('/forecast-report', async (req, res) => {
  try {
    const filter: { accountId?: string[]; memberId?: string[] } = {};
    if (Array.isArray(req.body.accountId)) filter.accountId = req.body.accountId;
    if (Array.isArray(req.body.memberId)) filter.memberId = req.body.memberId;
    const r = await buildForecastReport(filter);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

router.get('/anomalies', (req, res) => {
  const accountId = (req.query.accountId as string) || undefined;
  res.json(detectAnomalies(accountId));
});

router.post('/anomalies/:id/confirm', (_req, res) => res.json({ ok: true }));

router.get('/subscriptions', (req, res) => {
  const accountId = (req.query.accountId as string) || undefined;
  res.json(detectSubscriptions(accountId));
});

router.get('/status', (_req, res) => {
  res.json({ enabled: isAiEnabled() });
});

// Phase 2 §5.2 — list cloud-hosted models.
router.get('/models', async (_req, res) => {
  const r = await listCloudModels();
  res.json(r);
});

// Phase 2 §5.3 — test connection. Accepts optional baseUrl/apiKey overrides (pre-save).
router.post('/test-connection', async (req, res) => {
  const parsed = z.object({ baseUrl: z.string().optional(), apiKey: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = await testConnection(parsed.data);
  res.json(r);
});

router.get('/test-history', (_req, res) => {
  res.json(testHistory());
});

// AI category suggestion for uncategorized transactions (on-demand path still available, Phase 2 §3.2).
router.post('/suggest-category', async (req, res) => {
  const parsed = z
    .object({
      description: z.string(),
      amount: z.number().optional(),
      memberId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!isAiEnabled()) return res.json({ categoryId: null, message: 'AI disabled' });

  const cats = getDb().select().from(schema.categories).all();
  const catList = cats.map((c) => c.name).join(', ');
  // AI prompt includes the full raw description (Phase 2 §10).
  const prompt = `Given this bank transaction description: "${parsed.data.description}"${parsed.data.amount ? ` (amount: ${parsed.data.amount} AUD)` : ''}, choose the single best category from this list: ${catList}. Reply with ONLY the exact category name, nothing else.`;
  try {
    const out = (await getProvider().chat(prompt)).trim();
    const match = cats.find((c) => c.name.toLowerCase() === out.toLowerCase() || out.toLowerCase().includes(c.name.toLowerCase()));
    res.json({ categoryId: match?.id ?? null, suggestedName: out });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
});

export default router;