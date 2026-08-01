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

/** Detect + persist transfer links for credit-card <-> repayment-account pairs and
 *  investment-account <-> funding-account pairs. In both shapes credits land on the
 *  "destination" account (card payment received / investment deposit) and the matching
 *  debits leave the linked source account (repayment / funding). The link is declared
 *  on the destination account via `linkedRepaymentAccountId`.
 *  Returns the number of newly-linked pairs. Safe to call repeatedly (idempotent). */
export function linkTransfers(): number {
  const d = getDb();
  const accts = d.select().from(schema.accounts).all();
  const dests = accts.filter(
    (a) => (a.type === 'credit_card' || a.type === 'investment') && a.linkedRepaymentAccountId,
  );
  // Shared so a single source-side debit is consumed by at most one destination
  // (e.g. one savings account funding both a card and an investment account).
  const usedSource = new Set<string>();
  const usedDest = new Set<string>();
  let linked = 0;
  for (const dest of dests) {
    const sourceId = dest.linkedRepaymentAccountId!;
    linked += linkPair(d, dest.id, sourceId, dest.name, usedSource, usedDest);
  }
  return linked;
}

function linkPair(
  d: ReturnType<typeof getDb>,
  destId: string,
  sourceId: string,
  destName: string,
  usedSource: Set<string>,
  usedDest: Set<string>,
): number {
  const destTxns = d.select().from(schema.transactions).where(eq(schema.transactions.accountId, destId)).all() as TxRow[];
  const sourceTxns = d.select().from(schema.transactions).where(eq(schema.transactions.accountId, sourceId)).all() as TxRow[];

  // Source-side candidates: debits (money leaving to pay the card / fund the investment).
  const sourceCandidates = sourceTxns.filter((t) => t.amount < 0 && !t.isTransfer && !usedSource.has(t.id));
  // Destination-side candidates: credits (payment received / deposit arriving => positive amount).
  const destCandidates = destTxns.filter((t) => t.amount > 0 && !t.isTransfer && !usedDest.has(t.id));

  let linked = 0;

  for (const r of sourceCandidates) {
    // Description hint: does this debit reference the destination account?
    const hintsDest = BPAY_PATTERNS.some((p) => p.test(r.description)) || r.description.toLowerCase().includes(destName.toLowerCase());
    // Find best destination-side match: same date (±2 days), amount within $1, prefer description hint.
    let best: TxRow | null = null;
    let bestScore = Infinity;
    for (const c of destCandidates) {
      if (usedDest.has(c.id)) continue;
      const dayDiff = Math.abs(daysBetween(r.date, c.date));
      const amtDiff = Math.abs(Math.abs(r.amount) - Math.abs(c.amount));
      if (dayDiff > 2) continue;
      if (amtDiff > 1) continue;
      const score = dayDiff * 10 + amtDiff + (hintsDest ? 0 : 100);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      usedSource.add(r.id);
      usedDest.add(best.id);
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