import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import { randomUUID } from 'node:crypto';
import type { RuleDto, RuleMatchType, RuleSource } from '@homefinance/shared';
import { countRuleMatches } from '../services/rules.js';
import { allSeedRules, SEED_RULES_VERSION } from '@homefinance/shared';

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
  ruleSource: z.enum(['manual', 'ai_generated', 'seeded']).optional(),
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
    ruleSource: (r.ruleSource as RuleSource) ?? 'manual',
    updatedFromAiAt: r.updatedFromAiAt ?? null,
    seedVersion: r.seedVersion ?? null,
  };
}

router.get('/', (req, res) => {
  let rows = db().select().from(schema.rules).all().sort((a, b) => a.priority - b.priority);
  const source = req.query.source as string | undefined;
  if (source) rows = rows.filter((r) => (r.ruleSource ?? 'manual') === source);
  res.json(rows.map(map));
});

router.post('/', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.rules)
    .values({
      id: uid(),
      matchType: parsed.data.matchType,
      matchValue: parsed.data.matchValue,
      amountMin: parsed.data.amountMin ?? null,
      amountMax: parsed.data.amountMax ?? null,
      categoryId: parsed.data.categoryId,
      priority: parsed.data.priority,
      isActive: parsed.data.isActive,
      ruleSource: parsed.data.ruleSource ?? 'manual',
    })
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

// Phase 2 §9.2 — list the seeded default rule pack (active vs removed in this DB).
router.get('/seed-defaults', (_req, res) => {
  const cats = db().select().from(schema.categories).all();
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  const existing = db().select().from(schema.rules).all();
  const seed = allSeedRules().map((r, idx) => {
    const categoryId = catByName.get(r.category) ?? null;
    const inDb = existing.find((e) => e.matchValue.toLowerCase() === r.matchValue.toLowerCase() && (e.ruleSource ?? 'manual') === 'seeded');
    return {
      index: idx,
      tier: r.tier,
      matchType: r.matchType,
      matchValue: r.matchValue,
      category: r.category,
      categoryId,
      seedVersion: SEED_RULES_VERSION,
      active: !!inDb && inDb.isActive,
      removed: !inDb,
      ruleId: inDb?.id ?? null,
    };
  });
  res.json(seed);
});

// Phase 2 §9.2 — re-enable / re-add a specific deleted default rule.
router.post('/seed-defaults/restore', (req, res) => {
  const matchValue = z.string().safeParse(req.body.matchValue);
  if (!matchValue.success) return res.status(400).json({ error: 'matchValue required' });
  const seed = allSeedRules().find((r) => r.matchValue.toLowerCase() === matchValue.data.toLowerCase());
  if (!seed) return res.status(404).json({ error: 'default rule not found in seed pack' });
  const cats = db().select().from(schema.categories).all();
  const cat = cats.find((c) => c.name === seed.category);
  if (!cat) return res.status(400).json({ error: `seed category "${seed.category}" missing` });
  // Re-add if not present.
  const existing = db().select().from(schema.rules).all().find((e) => e.matchValue.toLowerCase() === seed.matchValue.toLowerCase() && (e.ruleSource ?? 'manual') === 'seeded');
  if (existing) {
    db().update(schema.rules).set({ isActive: true }).where(eq(schema.rules.id, existing.id)).run();
    return res.json({ ok: true, ruleId: existing.id, reactivated: true });
  }
  const id = randomUUID();
  const prio = seed.tier === 'merchant' ? 1000 : 3000;
  db().insert(schema.rules).values({ id, matchType: seed.matchType, matchValue: seed.matchValue, categoryId: cat.id, priority: prio, isActive: true, ruleSource: 'seeded', seedVersion: SEED_RULES_VERSION }).run();
  res.status(201).json({ ok: true, ruleId: id, reactivated: false });
});

export default router;