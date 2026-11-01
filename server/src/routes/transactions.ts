import { Router } from 'express';
import { z } from 'zod';
import { paged, createManual, DuplicateTransactionError, updateTransaction, bulkCategorize, categorizeViaRules, markReviewed, deleteAllTransactions, deleteTransaction } from '../services/transactions.js';
import { recategorizeTransactions } from '../services/ai.js';
import { manualLink, manualUnlink } from '../services/transfers.js';
import { createJob, finishJob, failJob } from '../services/jobs.js';
import type { CategorySource } from '@homefinance/shared';

const router = Router();

// Query strings arrive as a single value (`accountId=id`) or a repeated key.
// Accept either, plus a comma-separated list, and always hand the service string[].
const stringList = z.union([z.string(), z.array(z.string())]).optional().transform((v) => {
  if (v == null || v === '') return undefined;
  const parts = (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
});

// z.coerce.boolean() uses Boolean(), so the string "false" becomes true.
const queryBool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).optional().transform((v) => {
  if (v == null) return undefined;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1';
});

export const transactionFilterSchema = z.object({
  accountId: stringList,
  categoryId: stringList,
  memberId: stringList,
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  search: z.string().optional(),
  needsReview: queryBool,
  isTransfer: queryBool,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.string().optional(),
});

router.get('/', (req, res) => {
  const parsed = transactionFilterSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(paged(parsed.data));
});

const manualSchema = z.object({
  accountId: z.string(),
  date: z.string(),
  time: z.string().nullish(),
  description: z.string().min(1),
  amount: z.number(),
  categoryId: z.string().nullish(),
  balance: z.number().nullish(),
});

router.post('/', (req, res) => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.status(201).json(createManual(parsed.data));
  } catch (e) {
    if (e instanceof DuplicateTransactionError) return res.status(409).json({ error: e.message });
    throw e;
  }
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
      time: z.string().nullish().optional(),
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
  const result = updateTransaction(req.params.id, patch);
  if (result === 'notfound') return res.status(404).json({ error: 'not found' });
  if (result === 'duplicate') return res.status(409).json({ error: 'duplicate transaction' });
  res.json(result);
});

router.delete('/:id', (req, res) => {
  deleteTransaction(req.params.id);
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

// Re-categorize selected (or all) transactions: rules first, then AI for the rest.
// Optional web search to identify merchants. Runs as a job; progress via SSE.
router.post('/recategorize', (req, res) => {
  const parsed = z
    .object({ ids: z.array(z.string()).optional(), useWebSearch: z.boolean().default(true) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const job = createJob('recategorize', 0);
  recategorizeTransactions(parsed.data, job.id)
    .then((r) => finishJob(job.id, r))
    .catch((e) => failJob(job.id, (e as Error).message));
  res.status(202).json({ jobId: job.id });
});

// Delete ALL transactions (irreversible). Wipes transactions + AI categorization
// log. Keeps accounts, categories, rules, and import-batch metadata. The
// `confirm` body must equal 'DELETE' as a server-side guard.
router.delete('/', (req, res) => {
  const parsed = z.object({ confirm: z.literal('DELETE') }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Confirmation required: send { confirm: "DELETE" }' });
  deleteAllTransactions();
  res.json({ ok: true });
});

export default router;