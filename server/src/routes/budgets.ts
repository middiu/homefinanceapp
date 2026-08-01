import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { BudgetDto } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const putSchema = z.object({ monthlyAmount: z.number().min(0) });

function mapBudget(b: typeof schema.categoryBudgets.$inferSelect, categoryName: string): BudgetDto {
  return { categoryId: b.categoryId, categoryName, monthlyAmount: b.monthlyAmount };
}

// List all budgets joined with their category name.
router.get('/', (_req, res) => {
  const d = getDb();
  const cats = new Map(d.select().from(schema.categories).all().map((c) => [c.id, c.name]));
  const rows = d.select().from(schema.categoryBudgets).all();
  res.json(rows.map((b) => mapBudget(b, cats.get(b.categoryId) ?? 'Unknown')).sort((a, b) => a.categoryName.localeCompare(b.categoryName)));
});

// Upsert a budget for a category (insert-or-update on the unique categoryId).
router.put('/:categoryId', (req, res) => {
  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { categoryId } = req.params;
  const { monthlyAmount } = parsed.data;
  const d = getDb();
  const cat = d.select().from(schema.categories).where(eq(schema.categories.id, categoryId)).get();
  if (!cat) return res.status(404).json({ error: 'category not found' });
  const existing = d.select().from(schema.categoryBudgets).where(eq(schema.categoryBudgets.categoryId, categoryId)).get();
  if (existing) {
    d.update(schema.categoryBudgets).set({ monthlyAmount }).where(eq(schema.categoryBudgets.id, existing.id)).run();
    return res.json(mapBudget({ ...existing, monthlyAmount }, cat.name));
  }
  const r = d
    .insert(schema.categoryBudgets)
    .values({ id: uid(), categoryId, monthlyAmount })
    .returning()
    .get();
  res.status(201).json(mapBudget(r, cat.name));
});

router.delete('/:categoryId', (req, res) => {
  db().delete(schema.categoryBudgets).where(eq(schema.categoryBudgets.categoryId, req.params.categoryId)).run();
  res.status(204).end();
});

export default router;