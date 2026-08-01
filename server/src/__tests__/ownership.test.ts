import { describe, it, expect, beforeAll } from 'vitest';
import { setupDb, getDb, schema, randomUUID } from './dbHelper.js';
import { uid, dedupHash } from '../utils.js';
import { ownershipMap } from '../services/transactions.js';
import { matchRule } from '../services/rules.js';

let emilioId: string;
let partnerId: string;
let jointAcctId: string;
let soloAcctId: string;

beforeAll(() => {
  setupDb();
  const db = getDb();
  emilioId = uid();
  partnerId = uid();
  jointAcctId = uid();
  soloAcctId = uid();

  db.insert(schema.members).values({ id: emilioId, name: 'Emilio', color: '#3b82f6' }).run();
  db.insert(schema.members).values({ id: partnerId, name: 'Partner', color: '#ec4899' }).run();
  db.insert(schema.accounts).values({ id: jointAcctId, name: 'Joint', type: 'transaction', openingBalance: 0 }).run();
  db.insert(schema.accounts).values({ id: soloAcctId, name: 'Solo', type: 'savings', openingBalance: 0 }).run();

  // Joint 60/40
  db.insert(schema.accountOwnership).values({ id: uid(), accountId: jointAcctId, memberId: emilioId, percentage: 60 }).run();
  db.insert(schema.accountOwnership).values({ id: uid(), accountId: jointAcctId, memberId: partnerId, percentage: 40 }).run();
  // Solo 100 Emilio
  db.insert(schema.accountOwnership).values({ id: uid(), accountId: soloAcctId, memberId: emilioId, percentage: 100 }).run();

  // Transactions: $100 on joint, $200 on solo (both expenses)
  const t1 = { id: uid(), accountId: jointAcctId, date: '2026-07-01', description: 'Groceries', amount: -100, dedupHash: dedupHash(jointAcctId, '2026-07-01', -100, 'Groceries'), source: 'manual' as const, isTransfer: false };
  const t2 = { id: uid(), accountId: soloAcctId, date: '2026-07-02', description: 'Books', amount: -200, dedupHash: dedupHash(soloAcctId, '2026-07-02', -200, 'Books'), source: 'manual' as const, isTransfer: false };
  db.insert(schema.transactions).values(t1).run();
  db.insert(schema.transactions).values(t2).run();
});

describe('ownership split', () => {
  it('builds account -> member -> pct map', () => {
    const m = ownershipMap();
    expect(m.get(jointAcctId)!.get(emilioId)).toBe(60);
    expect(m.get(jointAcctId)!.get(partnerId)).toBe(40);
    expect(m.get(soloAcctId)!.get(emilioId)).toBe(100);
  });

  it('splits a joint transaction across owners', () => {
    const own = ownershipMap();
    const jointPct = own.get(jointAcctId)!.get(emilioId)!;
    const partnerPct = own.get(jointAcctId)!.get(partnerId)!;
    const amount = -100;
    expect(Math.round((amount * jointPct) / 100)).toBe(-60); // Emilio's share
    expect(Math.round((amount * partnerPct) / 100)).toBe(-40); // Partner's share
    expect(jointPct + partnerPct).toBe(100);
  });

  it('attributes full amount to a single-owner account', () => {
    const own = ownershipMap();
    const pct = own.get(soloAcctId)!.get(emilioId)!;
    expect(Math.round((-200 * pct) / 100)).toBe(-200);
  });

  it('Emilio total attributed spend = 60% of joint + 100% of solo', () => {
    const own = ownershipMap();
    const jointShare = (-100 * (own.get(jointAcctId)!.get(emilioId) ?? 0)) / 100;
    const soloShare = (-200 * (own.get(soloAcctId)!.get(emilioId) ?? 0)) / 100;
    expect(Math.round((jointShare + soloShare) * 100) / 100).toBe(-260);
  });

  it('dedup hash prevents re-import duplicates', () => {
    const h = dedupHash(jointAcctId, '2026-07-01', -100, 'Groceries');
    const exists = getDb().select().from(schema.transactions).all().some((t) => t.dedupHash === h);
    expect(exists).toBe(true);
    // different description => different hash => not present
    const h2 = dedupHash(jointAcctId, '2026-07-01', -100, 'Something else');
    const exists2 = getDb().select().from(schema.transactions).all().some((t) => t.dedupHash === h2);
    expect(exists2).toBe(false);
  });

  it('rule engine returns null without matching rules (no categories configured to match)', () => {
    expect(matchRule('Groceries', -100)).toBeNull();
  });
});