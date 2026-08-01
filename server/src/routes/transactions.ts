import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { paged, createManual, bulkCategorize, mapTx, categorizeViaRules, markReviewed } from '../services/transactions.js';
import { manualLink, manualUnlink } from '../services/transfers.js';
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
  needsReview: z.coerce.boolean().optional(),
  isTransfer: z.coerce.boolean().optional(),
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
      source: z.enum(['manual', 'rule', 'ai', 'ai_auto', 'ai_suggested_accepted']).optional(),
      description: z.string().optional(),
      rawDescription: z.string().optional(),
      amount: z.number().optional(),
      date: z.string().optional(),
      isTransfer: z.boolean().optional(),
      needsReview: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // Any manual categorization/edit clears needs_review (Phase 2 §3.2).
  const patch: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.categoryId !== undefined || parsed.data.source === 'manual') {
    patch.needsReview = false;
  }
  if (parsed.data.needsReview !== undefined) patch.needsReview = parsed.data.needsReview;
  const r = db()
    .update(schema.transactions)
    .set(patch)
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
    .object({ ids: z.array(z.string()).min(1), categoryId: z.string().nullish(), source: z.enum(['manual', 'rule', 'ai', 'ai_auto', 'ai_suggested_accepted']).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  bulkCategorize(parsed.data.ids, parsed.data.categoryId ?? null, parsed.data.source as CategorySource);
  res.json({ ok: true, count: parsed.data.ids.length });
});

// Phase 2 §3.2 — mark a set of transactions as reviewed (clear needs_review).
router.post('/review', (req, res) => {
  const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  markReviewed(parsed.data.ids);
  res.json({ ok: true, count: parsed.data.ids.length });
});

// Suggest category for a single transaction via rules (no AI). Returns { categoryId } or null.
router.post('/suggest', (req, res) => {
  const parsed = z.object({ description: z.string(), amount: z.number() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json({ categoryId: categorizeViaRules(parsed.data.description, parsed.data.amount) });
});

// Phase 2 §2.2 — manual transfer link/unlink override.
router.post('/:id/link', (req, res) => {
  const parsed = z.object({ linkedTransactionId: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    manualLink(req.params.id, parsed.data.linkedTransactionId);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/:id/unlink', (req, res) => {
  try {
    manualUnlink(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

export default router;