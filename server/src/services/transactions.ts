import { SQL, and, eq, gte, lte, like, or, desc, asc, sql } from 'drizzle-orm';
import { getDb, schema, getSqlite } from '../db/index.js';
import type { TransactionFilter, TransactionDto, PagedResult, CategorySource } from '@homefinance/shared';
import { uid, dedupHash, nowISO, parseTime } from '../utils.js';
import { matchRule } from './rules.js';

export function mapTx(r: typeof schema.transactions.$inferSelect): TransactionDto {
  return {
    id: r.id,
    accountId: r.accountId,
    date: r.date,
    time: r.time,
    description: r.description,
    rawDescription: r.rawDescription,
    amount: r.amount,
    categoryId: r.categoryId,
    source: r.source as CategorySource,
    importBatchId: r.importBatchId,
    isTransfer: r.isTransfer,
    linkedTransactionId: r.linkedTransactionId,
    needsReview: r.needsReview,
    balance: r.balance,
    createdAt: r.createdAt,
  };
}

/** Ownership map: accountId -> Map<memberId, percentage> */
export function ownershipMap(): Map<string, Map<string, number>> {
  const rows = getDb().select().from(schema.accountOwnership).all();
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!m.has(r.accountId)) m.set(r.accountId, new Map());
    m.get(r.accountId)!.set(r.memberId, r.percentage);
  }
  return m;
}

export function buildFilter(filter: TransactionFilter): SQL[] {
  const conds: SQL[] = [];
  if (filter.accountId?.length) conds.push(or(...filter.accountId.map((a) => eq(schema.transactions.accountId, a)))!);
  if (filter.categoryId?.length) conds.push(or(...filter.categoryId.map((c) => eq(schema.transactions.categoryId, c)))!);
  if (filter.dateFrom) conds.push(gte(schema.transactions.date, filter.dateFrom));
  if (filter.dateTo) conds.push(lte(schema.transactions.date, filter.dateTo));
  if (filter.amountMin != null) conds.push(gte(schema.transactions.amount, filter.amountMin));
  if (filter.amountMax != null) conds.push(lte(schema.transactions.amount, filter.amountMax));
  if (filter.search) conds.push(like(schema.transactions.description, `%${filter.search}%`));
  if (filter.needsReview) conds.push(eq(schema.transactions.needsReview, true));
  if (filter.isTransfer != null) conds.push(eq(schema.transactions.isTransfer, filter.isTransfer));
  return conds;
}

export function queryTransactions(filter: TransactionFilter): { rows: (TransactionDto & { shareAmount?: number })[]; total: number } {
  const d = getDb();
  const conds = buildFilter(filter);

  // memberId scope: restrict to accounts owned by member; compute share amount.
  let memberAccountIds: Set<string> | null = null;
  let memberPct = new Map<string, number>();
  if (filter.memberId?.length) {
    const own = ownershipMap();
    const result = new Set<string>();
    for (const [acct, members] of own) {
      for (const m of filter.memberId) {
        if (members.has(m)) {
          result.add(acct);
          memberPct.set(acct, members.get(m)!);
        }
      }
    }
    memberAccountIds = result;
    if (conds.length === 0 && memberAccountIds.size === 0) {
      return { rows: [], total: 0 };
    }
    conds.push(or(...[...memberAccountIds].map((a) => eq(schema.transactions.accountId, a)))!);
  }

  const where = conds.length ? and(...conds) : undefined;
  const all = d.select().from(schema.transactions).where(where).all();

  // sort
  const sort = filter.sort || 'date:desc';
  const [field, dir] = sort.split(':');
  all.sort((a, b) => {
    let cmp = 0;
    if (field === 'amount') cmp = a.amount - b.amount;
    else if (field === 'description') cmp = a.description.localeCompare(b.description);
    else cmp = a.date.localeCompare(b.date);
    return dir === 'asc' ? cmp : -cmp;
  });

  const total = all.length;
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const start = (page - 1) * pageSize;
  let rows = all.slice(start, start + pageSize).map(mapTx);

  if (filter.memberId?.length) {
    rows = rows.map((r) => {
      const pct = memberPct.get(r.accountId) ?? 100;
      return { ...r, shareAmount: Math.round((r.amount * pct) / 100 * 100) / 100 };
    });
  }

  return { rows, total };
}

export function paged(filter: TransactionFilter): PagedResult<TransactionDto & { shareAmount?: number }> {
  const { rows, total } = queryTransactions(filter);
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  return { items: rows, total, page, pageSize };
}

export function createManual(input: {
  accountId: string;
  date: string;
  time?: string | null;
  description: string;
  amount: number;
  categoryId?: string | null;
  balance?: number | null;
}): TransactionDto {
  const d = getDb();
  const id = uid();
  const time = parseTime(input.time ?? null);
  const hash = dedupHash(input.accountId, input.date, input.amount, input.description, time);
  const r = d
    .insert(schema.transactions)
    .values({
      id,
      accountId: input.accountId,
      date: input.date,
      time,
      description: input.description,
      rawDescription: input.description,
      amount: input.amount,
      balance: input.balance ?? null,
      categoryId: input.categoryId ?? null,
      source: 'manual',
      isTransfer: false,
      needsReview: false,
      dedupHash: hash,
    })
    .returning()
    .get();
  return mapTx(r);
}

/** Any manual confirm/edit clears needs_review (Phase 2 §3.2). */
export function bulkCategorize(ids: string[], categoryId: string | null, source: CategorySource = 'manual') {
  const d = getDb();
  for (const id of ids) {
    d.update(schema.transactions).set({ categoryId, source, needsReview: false }).where(eq(schema.transactions.id, id)).run();
  }
}

export function markReviewed(ids: string[]) {
  const d = getDb();
  for (const id of ids) {
    d.update(schema.transactions).set({ needsReview: false }).where(eq(schema.transactions.id, id)).run();
  }
}

/** Apply rule engine to a single transaction; returns categoryId or null. */
export function categorizeViaRules(description: string, amount: number): string | null {
  return matchRule(description, amount);
}

/** Permanently delete every transaction and the AI categorization log.
 *  Keeps accounts, categories, rules, and import-batch metadata. */
export function deleteAllTransactions(): void {
  const d = getDb();
  getSqlite().transaction(() => {
    d.delete(schema.aiCategorizationLog).run();
    d.delete(schema.transactions).run();
  })();
}