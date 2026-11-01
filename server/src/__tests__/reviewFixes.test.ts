import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { setupDb, getDb, schema } from './dbHelper.js';
import { uid } from '../utils.js';
import { config } from '../config.js';
import { transactionFilterSchema } from '../routes/transactions.js';
import {
  createManual,
  DuplicateTransactionError,
  updateTransaction,
  deleteTransaction,
  undoImportBatch,
} from '../services/transactions.js';
import { backupDb } from '../services/backup.js';
import { requireAuth, SESSION_COOKIE } from '../middleware/auth.js';
import { seedAdmin, createSession, getUserByUsername, changePassword } from '../services/auth.js';
import { suggestCategoryPrompt, buildForecastReport } from '../services/ai.js';

beforeAll(() => setupDb());

describe('transaction filter query', () => {
  it('accepts a single account id and needsReview=false', () => {
    const parsed = transactionFilterSchema.safeParse({
      accountId: 'acct-1',
      categoryId: 'cat-1,cat-2',
      needsReview: 'false',
      isTransfer: 'true',
      page: '2',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.accountId).toEqual(['acct-1']);
    expect(parsed.data.categoryId).toEqual(['cat-1', 'cat-2']);
    expect(parsed.data.needsReview).toBe(false);
    expect(parsed.data.isTransfer).toBe(true);
    expect(parsed.data.page).toBe(2);
  });
});

describe('dedup on write', () => {
  it('rejects a manual duplicate and a colliding edit', () => {
    const db = getDb();
    const accountId = uid();
    db.insert(schema.accounts).values({ id: accountId, name: 'Dedup', type: 'transaction', openingBalance: 0 }).run();
    const first = createManual({ accountId, date: '2026-04-01', description: 'Coffee', amount: -4.5 });
    expect(() => createManual({ accountId, date: '2026-04-01', description: 'Coffee', amount: -4.5 })).toThrow(DuplicateTransactionError);
    const other = createManual({ accountId, date: '2026-04-02', description: 'Tea', amount: -3 });
    expect(updateTransaction(other.id, { description: 'Coffee', date: '2026-04-01', amount: -4.5 })).toBe('duplicate');
    const before = db.select().from(schema.transactions).where(eq(schema.transactions.id, first.id)).get();
    const updated = updateTransaction(first.id, { description: 'Coffee shop' });
    expect(updated).not.toBe('duplicate');
    if (updated === 'notfound' || updated === 'duplicate') throw new Error('expected row');
    expect(updated.description).toBe('Coffee shop');
    const after = db.select().from(schema.transactions).where(eq(schema.transactions.id, first.id)).get();
    expect(after?.dedupHash).not.toBe(before?.dedupHash);
  });
});

describe('transfer partner cleanup', () => {
  it('clears the partner link when a transaction is deleted', () => {
    const db = getDb();
    const a = uid();
    const b = uid();
    const acct = uid();
    db.insert(schema.accounts).values({ id: acct, name: 'Link', type: 'transaction', openingBalance: 0 }).run();
    db.insert(schema.transactions).values({
      id: a, accountId: acct, date: '2026-05-01', description: 'out', amount: -10, source: 'manual', dedupHash: a, isTransfer: true, linkedTransactionId: b,
    }).run();
    db.insert(schema.transactions).values({
      id: b, accountId: acct, date: '2026-05-01', description: 'in', amount: 10, source: 'manual', dedupHash: b, isTransfer: true, linkedTransactionId: a,
    }).run();
    deleteTransaction(a);
    const partner = db.select().from(schema.transactions).where(eq(schema.transactions.id, b)).get();
    expect(partner?.isTransfer).toBe(false);
    expect(partner?.linkedTransactionId).toBeNull();
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, a)).get()).toBeUndefined();
  });

  it('undoes a batch and drops the AI log plus outside links', () => {
    const db = getDb();
    const acct = uid();
    const batch = uid();
    const imported = uid();
    const manual = uid();
    db.insert(schema.accounts).values({ id: acct, name: 'Batch', type: 'transaction', openingBalance: 0 }).run();
    db.insert(schema.importBatches).values({ id: batch, accountId: acct, fileName: 'a.csv', fileFormat: 'csv', rowCount: 1 }).run();
    db.insert(schema.transactions).values({
      id: imported, accountId: acct, date: '2026-05-02', description: 'imported', amount: -8, source: 'rule', dedupHash: imported, importBatchId: batch, isTransfer: true, linkedTransactionId: manual,
    }).run();
    db.insert(schema.transactions).values({
      id: manual, accountId: acct, date: '2026-05-02', description: 'manual', amount: 8, source: 'manual', dedupHash: manual, isTransfer: true, linkedTransactionId: imported,
    }).run();
    db.insert(schema.aiCategorizationLog).values({ id: uid(), transactionId: imported, description: 'imported', applied: false }).run();
    undoImportBatch(batch);
    expect(db.select().from(schema.transactions).where(eq(schema.transactions.id, imported)).get()).toBeUndefined();
    expect(db.select().from(schema.importBatches).where(eq(schema.importBatches.id, batch)).get()).toBeUndefined();
    expect(db.select().from(schema.aiCategorizationLog).all().some((r) => r.transactionId === imported)).toBe(false);
    const kept = db.select().from(schema.transactions).where(eq(schema.transactions.id, manual)).get();
    expect(kept?.isTransfer).toBe(false);
    expect(kept?.linkedTransactionId).toBeNull();
  });
});

describe('backupDb', () => {
  it('finishes the file before pruning older copies', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-bak-'));
    const prevDir = config.backup.dir;
    const prevKeep = config.backup.keep;
    config.backup.dir = dir;
    config.backup.keep = 2;
    try {
      fs.writeFileSync(path.join(dir, 'homefinance-2000-01-01T00-00-00-000Z.sqlite'), 'old1');
      fs.writeFileSync(path.join(dir, 'homefinance-2000-01-02T00-00-00-000Z.sqlite'), 'old2');
      fs.writeFileSync(path.join(dir, 'homefinance-2000-01-03T00-00-00-000Z.sqlite'), 'old3');
      const dest = await backupDb();
      expect(fs.readFileSync(dest).subarray(0, 15).toString()).toBe('SQLite format 3');
      const names = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite'));
      expect(names).toHaveLength(2);
      expect(names).toContain(path.basename(dest));
      expect(names).not.toContain('homefinance-2000-01-01T00-00-00-000Z.sqlite');
    } finally {
      config.backup.dir = prevDir;
      config.backup.keep = prevKeep;
    }
  });
});

describe('mustResetPassword gate', () => {
  it('returns 403 until the password is changed', async () => {
    await seedAdmin();
    const admin = getUserByUsername('admin')!;
    const { token } = createSession(admin.id);
    const blocked = callAuth(token);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.nexted).toBe(false);
    await changePassword(admin.id, 'replacement-password', token);
    const open = callAuth(token);
    expect(open.nexted).toBe(true);
    expect(callAuth(undefined).statusCode).toBe(401);
  });
});

function callAuth(token: string | undefined) {
  const req = { cookies: token ? { [SESSION_COOKIE]: token } : {} } as any;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  let nexted = false;
  requireAuth(req, res as any, () => { nexted = true; });
  return { statusCode: res.statusCode, body: res.body, nexted };
}

describe('suggestCategoryPrompt', () => {
  it('strips long digit runs before they reach the model', () => {
    const prompt = suggestCategoryPrompt('CARD 4521789100235611 COLES', -12.5, 'Groceries, Dining');
    expect(prompt).not.toMatch(/\d{4,}/);
    expect(prompt).toContain('COLES');
    expect(prompt).toContain('Groceries');
  });
});

describe('forecast member weighting', () => {
  it('scales history flows by ownership percent', async () => {
    const db = getDb();
    const acct = uid();
    const other = uid();
    const member = uid();
    db.insert(schema.members).values({ id: member, name: 'Scoped', color: '#111111' }).run();
    db.insert(schema.accounts).values({ id: acct, name: 'Half', type: 'transaction', openingBalance: 0 }).run();
    db.insert(schema.accounts).values({ id: other, name: 'None', type: 'transaction', openingBalance: 0 }).run();
    db.insert(schema.accountOwnership).values({ id: uid(), accountId: acct, memberId: member, percentage: 50 }).run();
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const month = date.slice(0, 7);
    db.insert(schema.transactions).values({
      id: uid(), accountId: acct, date, description: 'shared spend', amount: -200, source: 'manual', dedupHash: uid(), isTransfer: false,
    }).run();
    db.insert(schema.transactions).values({
      id: uid(), accountId: other, date, description: 'other spend', amount: -500, source: 'manual', dedupHash: uid(), isTransfer: false,
    }).run();
    const report = await buildForecastReport({ memberId: [member] });
    const row = report.history.find((h) => h.month === month);
    expect(row?.expense).toBe(100);
  });
});
