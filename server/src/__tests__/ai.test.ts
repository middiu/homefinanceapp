import { describe, it, expect, beforeAll } from 'vitest';
import { setupDb, getDb, schema, randomUUID } from './dbHelper.js';
import { normalizeHost, recategorizeTransactions, sanitizeForAi } from '../services/ai.js';
import { deleteAllTransactions } from '../services/transactions.js';
import { uid } from '../utils.js';
import { eq } from 'drizzle-orm';

let groceriesId: string;
let otherId: string;
let accountId: string;

beforeAll(() => {
  setupDb();
  const db = getDb();
  accountId = uid();
  db.insert(schema.accounts).values({ id: accountId, name: 'Test', type: 'transaction', currency: 'AUD', openingBalance: 0 }).run();
  const cats = db.select().from(schema.categories).all();
  groceriesId = cats.find((c) => c.name === 'Groceries')!.id;
  otherId = cats.find((c) => c.name === 'Other')!.id;
  // Rule: contains "woolworths" -> Groceries
  db.insert(schema.rules).values({ id: uid(), matchType: 'contains', matchValue: 'woolworths', categoryId: groceriesId, priority: 10, isActive: true }).run();
});

function insertTxn(description: string, amount: number) {
  const db = getDb();
  const id = uid();
  db.insert(schema.transactions)
    .values({
      id,
      accountId,
      date: '2026-01-15',
      description,
      rawDescription: description,
      amount,
      categoryId: null,
      source: 'manual',
      isTransfer: false,
      needsReview: false,
      dedupHash: randomUUID(),
    })
    .run();
  return id;
}

describe('normalizeHost', () => {
  it('strips trailing /v1 and slashes', () => {
    expect(normalizeHost('https://ollama.com/v1')).toBe('https://ollama.com');
    expect(normalizeHost('https://ollama.com/v1/')).toBe('https://ollama.com');
    expect(normalizeHost('https://ollama.com/')).toBe('https://ollama.com');
    expect(normalizeHost('https://ollama.com')).toBe('https://ollama.com');
  });
  it('falls back to default for empty input', () => {
    expect(normalizeHost('')).toBe('https://ollama.com');
  });
  it('leaves a custom host intact', () => {
    expect(normalizeHost('http://localhost:11434')).toBe('http://localhost:11434');
  });
});

describe('sanitizeForAi', () => {
  it('strips account/card/reference numbers and BSB', () => {
    expect(sanitizeForAi('WOOLWORTHS 1234 SYDNEY')).toBe('WOOLWORTHS SYDNEY');
    expect(sanitizeForAi('BSB 062-000 ACCT 12345678')).toBe('BSB ACCT');
    expect(sanitizeForAi('CARD 4521 7891 0023 5611 COLES')).toBe('CARD COLES');
    expect(sanitizeForAi('REF 9988776655 PAYROLL')).toBe('REF PAYROLL');
  });
  it('caps length at 80 chars', () => {
    const long = 'SHOP ' + 'X'.repeat(120);
    expect(sanitizeForAi(long).length).toBeLessThanOrEqual(80);
  });
  it('handles empty input', () => {
    expect(sanitizeForAi('')).toBe('');
    expect(sanitizeForAi('   ')).toBe('');
  });
  it('preserves merchant words needed for identification', () => {
    expect(sanitizeForAi('AMZN MKTP AU Sydney')).toBe('AMZN MKTP AU Sydney');
  });
});

describe('recategorizeTransactions', () => {
  it('applies current rules and leaves unmatched for AI (disabled here -> Other)', async () => {
    const matchId = insertTxn('WOOLWORTHS 1234 SYDNEY', -85.2);
    const noMatchId = insertTxn('MYSTERY SHOP XYZ', -20.0);
    const job = uid(); // no live job registered -> jobStage no-ops

    const r = await recategorizeTransactions({ useWebSearch: false }, job);
    expect(r.total).toBe(2);
    expect(r.rulesApplied).toBe(1);

    const db = getDb();
    const matched = db.select().from(schema.transactions).where(eq(schema.transactions.id, matchId)).get();
    expect(matched?.categoryId).toBe(groceriesId);
    expect(matched?.source).toBe('rule');
    expect(matched?.needsReview).toBe(false);

    // No rule match + AI disabled -> categorizeBatch falls back to "Other",
    // source='ai_auto', needsReview=true, applied=false (not counted).
    const unmatched = db.select().from(schema.transactions).where(eq(schema.transactions.id, noMatchId)).get();
    expect(unmatched?.categoryId).toBe(otherId);
    expect(unmatched?.source).toBe('ai_auto');
    expect(unmatched?.needsReview).toBe(true);
    expect(r.aiCategorized).toBe(0);
  });

  it('scopes to provided ids only', async () => {
    const inId = insertTxn('WOOLWORTHS CITY', -10);
    const outId = insertTxn('WOOLWORTHS OUT', -10);
    const r = await recategorizeTransactions({ ids: [inId], useWebSearch: false }, uid());
    expect(r.total).toBe(1);
    expect(r.rulesApplied).toBe(1);
    const db = getDb();
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, outId)).get()?.categoryId).toBeNull();
  });
});

describe('deleteAllTransactions', () => {
  it('removes every transaction and the AI categorization log', () => {
    insertTxn('TXN A', -1);
    insertTxn('TXN B', -2);
    const db = getDb();
    expect(db.select().from(schema.transactions).all().length).toBeGreaterThan(0);
    deleteAllTransactions();
    expect(db.select().from(schema.transactions).all().length).toBe(0);
    expect(db.select().from(schema.aiCategorizationLog).all().length).toBe(0);
  });
});