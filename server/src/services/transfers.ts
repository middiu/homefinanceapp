import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';

// Phase 2 §2 — link transfer pairs between a credit card and its linked repayment account.
// Since the card->repayment relationship is explicit on the account, a transaction moving
// funds between the two is auto-flagged is_transfer on both sides and the two rows are
// cross-linked via linked_transaction_id.

const BPAY_PATTERNS = [
  /bpay/i,
  /biller/i,
  /credit card/i,
  /card payment/i,
  /payment to/i,
  /transfer to/i,
  /repay/i,
];

interface TxRow {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  isTransfer: boolean;
}

/** Detect + persist transfer links for all credit-card <-> repayment-account pairs.
 *  Returns the number of newly-linked pairs. Safe to call repeatedly (idempotent). */
export function linkTransfers(): number {
  const d = getDb();
  const accts = d.select().from(schema.accounts).all();
  const cards = accts.filter((a) => a.type === 'credit_card' && a.linkedRepaymentAccountId);
  let linked = 0;
  for (const card of cards) {
    const repayId = card.linkedRepaymentAccountId!;
    linked += linkPair(d, card.id, repayId, card.name, accts.find((a) => a.id === repayId)?.name || '');
  }
  return linked;
}

function linkPair(
  d: ReturnType<typeof getDb>,
  cardId: string,
  repayId: string,
  cardName: string,
  repayName: string,
): number {
  const cardTxns = d.select().from(schema.transactions).where(eq(schema.transactions.accountId, cardId)).all() as TxRow[];
  const repayTxns = d.select().from(schema.transactions).where(eq(schema.transactions.accountId, repayId)).all() as TxRow[];

  // Candidates on the repayment account: debits (money leaving to pay the card).
  const repayCandidates = repayTxns.filter((t) => t.amount < 0 && !t.isTransfer);
  // Candidates on the card: credits (a payment received reduces card debt => positive amount).
  const cardCandidates = cardTxns.filter((t) => t.amount > 0 && !t.isTransfer);

  let linked = 0;
  const usedCard = new Set<string>();

  for (const r of repayCandidates) {
    // Description hint: does this repayment reference the card?
    const hintsCard = BPAY_PATTERNS.some((p) => p.test(r.description)) || r.description.toLowerCase().includes(cardName.toLowerCase());
    // Find best card-side match: same date (±2 days), amount within $1, prefer description hint.
    let best: TxRow | null = null;
    let bestScore = Infinity;
    for (const c of cardCandidates) {
      if (usedCard.has(c.id)) continue;
      const dayDiff = Math.abs(daysBetween(r.date, c.date));
      const amtDiff = Math.abs(Math.abs(r.amount) - Math.abs(c.amount));
      if (dayDiff > 2) continue;
      if (amtDiff > 1) continue;
      const score = dayDiff * 10 + amtDiff + (hintsCard ? 0 : 100);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      usedCard.add(best.id);
      pair(d, r, best);
      linked++;
    }
  }
  return linked;
}

function pair(d: ReturnType<typeof getDb>, a: TxRow, b: TxRow) {
  d.update(schema.transactions).set({ isTransfer: true, linkedTransactionId: b.id }).where(eq(schema.transactions.id, a.id)).run();
  d.update(schema.transactions).set({ isTransfer: true, linkedTransactionId: a.id }).where(eq(schema.transactions.id, b.id)).run();
}

function daysBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86400000;
}

/** Manual override (Phase 2 §2.2): link two transactions as a transfer pair. */
export function manualLink(idA: string, idB: string) {
  const d = getDb();
  const a = d.select().from(schema.transactions).where(eq(schema.transactions.id, idA)).get();
  const b = d.select().from(schema.transactions).where(eq(schema.transactions.id, idB)).get();
  if (!a || !b) throw new Error('one or both transactions not found');
  pair(d, a as TxRow, b as TxRow);
}

/** Manual override: un-flag a transaction as a transfer (and clear its partner's link too). */
export function manualUnlink(id: string) {
  const d = getDb();
  const t = d.select().from(schema.transactions).where(eq(schema.transactions.id, id)).get();
  if (!t) throw new Error('transaction not found');
  if (t.linkedTransactionId) {
    d.update(schema.transactions).set({ isTransfer: false, linkedTransactionId: null }).where(eq(schema.transactions.id, t.linkedTransactionId)).run();
  }
  d.update(schema.transactions).set({ isTransfer: false, linkedTransactionId: null }).where(eq(schema.transactions.id, id)).run();
}