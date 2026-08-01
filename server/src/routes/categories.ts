import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { CategoryDto, CategoryType } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const body = z.object({
  name: z.string().min(1),
  parentId: z.string().nullish(),
  isCustom: z.boolean().default(true),
  type: z.enum(['income', 'expense', 'transfer']).nullish(),
});

function map(r: typeof schema.categories.$inferSelect): CategoryDto {
  return { id: r.id, name: r.name, parentId: r.parentId, isCustom: r.isCustom, type: (r.type as CategoryType) ?? null };
}

router.get('/', (_req, res) => {
  res.json(db().select().from(schema.categories).all().map(map));
});

router.post('/', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.categories)
    .values({ id: uid(), ...parsed.data })
    .returning()
    .get();
  res.status(201).json(map(r));
});

router.put('/:id', (req, res) => {
  const parsed = body.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .update(schema.categories)
    .set(parsed.data)
    .where(eq(schema.categories.id, req.params.id))
    .returning()
    .get();
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(map(r));
});

router.delete('/:id', (req, res) => {
  db().delete(schema.categories).where(eq(schema.categories.id, req.params.id)).run();
  res.status(204).end();
});

export default router;