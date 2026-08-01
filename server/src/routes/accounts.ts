import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { AccountDto, AccountType, OwnershipDto } from '@homefinance/shared';

const router = Router();
const db = () => getDb();

const ownershipSchema = z.object({
  memberId: z.string(),
  percentage: z.number().min(0).max(100),
});

const body = z.object({
  name: z.string().min(1),
  institution: z.string().nullish(),
  type: z.enum(['transaction', 'savings', 'credit_card', 'loan', 'investment']),
  currency: z.string().default('AUD'),
  openingBalance: z.number().default(0),
  isArchived: z.boolean().default(false),
  ownership: z.array(ownershipSchema).min(1),
});

function loadOwnership(accountId: string): OwnershipDto[] {
  return db()
    .select()
    .from(schema.accountOwnership)
    .where(eq(schema.accountOwnership.accountId, accountId))
    .all()
    .map((o) => ({ memberId: o.memberId, percentage: o.percentage }));
}

function map(r: typeof schema.accounts.$inferSelect): AccountDto {
  return {
    id: r.id,
    name: r.name,
    institution: r.institution,
    type: r.type as AccountType,
    currency: r.currency,
    openingBalance: r.openingBalance,
    isArchived: r.isArchived,
    createdAt: r.createdAt,
    ownership: loadOwnership(r.id),
  };
}

function setOwnership(accountId: string, ownership: OwnershipDto[]) {
  const d = db();
  d.delete(schema.accountOwnership).where(eq(schema.accountOwnership.accountId, accountId)).run();
  // normalize to sum 100 if possible, but accept as given; validate sum=100 at API layer
  const sum = ownership.reduce((s, o) => s + o.percentage, 0);
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`ownership percentages must sum to 100, got ${sum}`);
  }
  for (const o of ownership) {
    d.insert(schema.accountOwnership)
      .values({ id: uid(), accountId, memberId: o.memberId, percentage: o.percentage })
      .run();
  }
}

router.get('/', (_req, res) => {
  res.json(db().select().from(schema.accounts).all().map(map));
});

router.post('/', (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { ownership, ...rest } = parsed.data;
  const id = uid();
  const d = db();
  d.insert(schema.accounts).values({ id, ...rest }).run();
  try {
    setOwnership(id, ownership);
  } catch (e) {
    d.delete(schema.accounts).where(eq(schema.accounts.id, id)).run();
    return res.status(400).json({ error: (e as Error).message });
  }
  res.status(201).json(map(d.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()!));
});

router.put('/:id', (req, res) => {
  const parsed = body.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const id = req.params.id;
  const d = db();
  const existing = d.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { ownership, ...rest } = parsed.data;
  if (Object.keys(rest).length) d.update(schema.accounts).set(rest).where(eq(schema.accounts.id, id)).run();
  if (ownership) {
    try {
      setOwnership(id, ownership);
    } catch (e) {
      return res.status(400).json({ error: (e as Error).message });
    }
  }
  res.json(map(d.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get()!));
});

router.delete('/:id', (req, res) => {
  db().delete(schema.accounts).where(eq(schema.accounts.id, req.params.id)).run();
  res.status(204).end();
});

export default router;