import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { RuleDto, RuleMatchType } from '@homefinance/shared';
import { countRuleMatches } from '../services/rules.js';

const router = Router();
const db = () => getDb();

const body = z.object({
  matchType: z.enum(['contains', 'regex', 'equals', 'amount_range']),
  matchValue: z.string(),
  amountMin: z.number().nullish(),
  amountMax: z.number().nullish(),
  categoryId: z.string(),
  priority: z.number().int().default(100),
  isActive: z.boolean().default(true),
});

function map(r: typeof schema.rules.$inferSelect): RuleDto {
  return {
    id: r.id,
    matchType: r.matchType as RuleMatchType,
    matchValue: r.matchValue,
    amountMin: r.amountMin,
    amountMax: r.amountMax,
    categoryId: r.categoryId,
    priority: r.priority,
    isActive: r.isActive,
  };
}

router.get('/', (_req, res) => {
  res.json(db().select().from(schema.rules).all().sort((a, b) => a.priority - b.priority).map(map));
});

router.post('/', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.rules)
    .values({ id: uid(), ...parsed.data, amountMin: parsed.data.amountMin ?? null, amountMax: parsed.data.amountMax ?? null })
    .returning()
    .get();
  res.status(201).json(map(r));
});

router.put('/:id', (req, res) => {
  const parsed = body.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .update(schema.rules)
    .set(parsed.data)
    .where(eq(schema.rules.id, req.params.id))
    .returning()
    .get();
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(map(r));
});

router.delete('/:id', (req, res) => {
  db().delete(schema.rules).where(eq(schema.rules.id, req.params.id)).run();
  res.status(204).end();
});

// Test a rule against existing data (preview, not persisted)
router.post('/test', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const count = countRuleMatches({
    matchType: parsed.data.matchType,
    matchValue: parsed.data.matchValue,
    amountMin: parsed.data.amountMin ?? null,
    amountMax: parsed.data.amountMax ?? null,
    categoryId: parsed.data.categoryId,
  });
  res.json({ matches: count });
});

// Reorder: body = { ids: [ordered rule ids] }
router.post('/reorder', (req, res) => {
  const ids = z.array(z.string()).safeParse(req.body.ids);
  if (!ids.success) return res.status(400).json({ error: 'ids array required' });
  const d = db();
  ids.data.forEach((id, i) => {
    d.update(schema.rules).set({ priority: i }).where(eq(schema.rules.id, id)).run();
  });
  res.json({ ok: true });
});

export default router;