import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { paged, createManual, bulkCategorize, mapTx, categorizeViaRules } from '../services/transactions.js';
import type { CategorySource } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const filterSchema = z.object({
  accountId: z.array(z.string()).optional(),
  categoryId: z.array(z.string()).optional(),
  memberId: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.string().optional(),
});

router.get('/', (req, res) => {
  const parsed = filterSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(paged(parsed.data));
});

const manualSchema = z.object({
  accountId: z.string(),
  date: z.string(),
  description: z.string().min(1),
  amount: z.number(),
  categoryId: z.string().nullish(),
  balance: z.number().nullish(),
});

router.post('/', (req, res) => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.status(201).json(createManual(parsed.data));
});

router.put('/:id', (req, res) => {
  const parsed = z
    .object({
      categoryId: z.string().nullish(),
      source: z.enum(['manual', 'rule', 'ai']).optional(),
      description: z.string().optional(),
      amount: z.number().optional(),
      date: z.string().optional(),
      isTransfer: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .update(schema.transactions)
    .set(parsed.data)
    .where(eq(schema.transactions.id, req.params.id))
    .returning()
    .get();
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(mapTx(r));
});

router.delete('/:id', (req, res) => {
  db().delete(schema.transactions).where(eq(schema.transactions.id, req.params.id)).run();
  res.status(204).end();
});

router.post('/bulk', (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string()).min(1), categoryId: z.string().nullish(), source: z.enum(['manual', 'rule', 'ai']).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  bulkCategorize(parsed.data.ids, parsed.data.categoryId ?? null, parsed.data.source as CategorySource);
  res.json({ ok: true, count: parsed.data.ids.length });
});

// Suggest category for a single transaction via rules (no AI). Returns { categoryId } or null.
router.post('/suggest', (req, res) => {
  const parsed = z.object({ description: z.string(), amount: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json({ categoryId: categorizeViaRules(parsed.data.description, parsed.data.amount) });
});

export default router;