import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { MemberDto } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const body = z.object({
  name: z.string().min(1),
  color: z.string().default('#6366f1'),
});

function map(r: typeof schema.members.$inferSelect): MemberDto {
  return { id: r.id, name: r.name, color: r.color, createdAt: r.createdAt };
}

router.get('/', (_req, res) => {
  res.json(db().select().from(schema.members).all().map(map));
});

router.post('/', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.members)
    .values({ id: uid(), ...parsed.data })
    .returning()
    .get();
  res.status(201).json(map(r));
});

router.put('/:id', (req, res) => {
  const parsed = body.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .update(schema.members)
    .set(parsed.data)
    .where(eq(schema.members.id, req.params.id))
    .returning()
    .get();
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(map(r));
});

router.delete('/:id', (req, res) => {
  db().delete(schema.members).where(eq(schema.members.id, req.params.id)).run();
  res.status(204).end();
});

export default router;