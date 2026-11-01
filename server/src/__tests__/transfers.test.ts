import { describe, it, expect, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupDb, getDb, schema } from './dbHelper.js';
import { uid } from '../utils.js';
import { linkTransfers, manualLink, manualUnlink } from '../services/transfers.js';

let cardId: string;
let repayId: string;

beforeAll(() => {
  setupDb();
  const db = getDb();
  cardId = uid();
  repayId = uid();
  db.insert(schema.accounts).values({ id: cardId, name: 'Visa', type: 'credit_card', linkedRepaymentAccountId: repayId, openingBalance: 0 }).run();
  db.insert(schema.accounts).values({ id: repayId, name: 'Everyday', type: 'transaction', openingBalance: 0 }).run();
});

function insertTx(accountId: string, date: string, description: string, amount: number) {
  const db = getDb();
  const id = uid();
  db.insert(schema.transactions).values({
    id, accountId, date, description, amount, source: 'manual', dedupHash: id,
  }).run();
  return id;
}

describe('transfer detection (M6)', () => {
  it('links a card payment to its repayment within ±$1 and ±2 days', () => {
    const rId = insertTx(repayId, '2024-05-10', 'BPAY VISA repayment', -1500);
    const cId = insertTx(cardId, '2024-05-11', 'Payment received', 1500);
    const n = linkTransfers();
    expect(n).toBeGreaterThanOrEqual(1);
    const db = getDb();
    const r = db.select().from(schema.transactions).where(eq(schema.transactions.id, rId)).get();
    const c = db.select().from(schema.transactions).where(eq(schema.transactions.id, cId)).get();
    expect(r?.isTransfer).toBe(true);
    expect(c?.isTransfer).toBe(true);
    expect(r?.linkedTransactionId).toBe(cId);
    expect(c?.linkedTransactionId).toBe(rId);
  });

  it('does not link when amounts differ by more than $1', () => {
    insertTx(repayId, '2024-06-01', 'BPAY VISA', -100);
    insertTx(cardId, '2024-06-01', 'Payment', 250);
    linkTransfers();
    const unlinked = getDb().select().from(schema.transactions).all().filter((t) => !t.isTransfer);
    // both new rows remain non-transfer
    expect(unlinked.length).toBeGreaterThanOrEqual(2);
  });

  it('leaves a tie between destination candidates unlinked', () => {
    const rId = insertTx(repayId, '2024-08-01', 'BPAY VISA', -80);
    insertTx(cardId, '2024-08-01', 'Payment received', 80);
    insertTx(cardId, '2024-08-01', 'Payment received again', 80);
    linkTransfers();
    const r = getDb().select().from(schema.transactions).where(eq(schema.transactions.id, rId)).get();
    expect(r?.isTransfer).toBe(false);
    expect(r?.linkedTransactionId).toBeNull();
  });

  it('manual link + unlink works', () => {
    const a = insertTx(repayId, '2024-07-01', 'manual A', -50);
    const b = insertTx(cardId, '2024-07-02', 'manual B', 50);
    manualLink(a, b);
    const db = getDb();
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, a)).get()?.isTransfer).toBe(true);
    manualUnlink(a);
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, a)).get()?.isTransfer).toBe(false);
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, b)).get()?.linkedTransactionId).toBeNull();
  });
});