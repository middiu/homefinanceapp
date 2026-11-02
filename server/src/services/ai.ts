import { getDb, schema } from '../db/index.js';
import { uid, round2 } from '../utils.js';
import { eq } from 'drizzle-orm';
import type { InsightType } from '@homefinance/shared';
import { matchRule, deriveMatchPattern, createOrUpdateAiRule, getActiveRules } from './rules.js';
import { ownershipMap } from './transactions.js';
import { updateJob } from './jobs.js';
import { aiWebSearch, chat, isAiEnabled } from './aiProvider.js';

export {
  aiWebSearch,
  isAiEnabled,
  isAutoCategorizeEnabled,
  listCloudModels,
  testConnection,
  normalizeHost,
} from './aiProvider.js';

export function getProvider(): { chat(prompt: string, system?: string): Promise<string> } {
  return { chat };
}

// ---- Privacy: sanitize before sending to cloud model (§4.5) ----
// The AI provider is a remote cloud service. Only the bare minimum needed for
// categorization may leave the server: a merchant/shop descriptor + the amount.
// Strip anything that could be sensitive banking info or personal data:
//   - account/card/reference numbers (runs of 4+ digits, BSB, card groups)
//   - long numeric identifiers
// Collapses whitespace and caps length. Merchant words are preserved (needed to
// identify the shop). Note: a free-text transfer memo may still contain a
// recipient name — transfers are therefore skipped for AI (see recategorize).
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b\d{3}[- ]?\d{3}\b/g, // BSB (6 digits, optional hyphen/space)
  /\b(?:\d[ -]?){13,19}\b/g, // card numbers (13–19 digits with separators)
  /\d{4,}/g, // any other run of 4+ digits (account/ref/transaction ids)
];

/** Prompt for on-demand category suggestion. Description is sanitized first. */
export function suggestCategoryPrompt(description: string, amount: number | undefined, categoryNames: string): string {
  const safe = sanitizeForAi(description);
  const amt = amount != null ? ` (amount: ${amount} AUD)` : '';
  return `Given this bank transaction description: "${safe}"${amt}, choose the single best category from this list: ${categoryNames}. Reply with ONLY the exact category name, nothing else.`;
}

export function sanitizeForAi(desc: string): string {
  let s = (desc || '').replace(/\s+/g, ' ').trim();
  for (const re of SENSITIVE_PATTERNS) s = s.replace(re, '');
  // collapse whitespace left by redactions, drop stray separators
  s = s.replace(/\s*[|/-]+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return s.slice(0, 80);
}

/** Emit a progress stage to a job (no-op if no jobId). */
function jobStage(jobId: string | undefined, stage: string, progress: number, total?: number, message = ''): void {
  if (!jobId) return;
  const patch: { stage: string; progress: number; message: string; total?: number } = { stage, progress, message };
  if (total !== undefined) patch.total = total;
  updateJob(jobId, patch);
}

// ---- Aggregation helpers (only send aggregates to AI, not raw dumps §4.5) ----
function categoryTotals(periodStart: string, periodEnd: string) {
  const d = getDb();
  const txns = d.select().from(schema.transactions).all().filter((t) => t.date >= periodStart && t.date <= periodEnd);
  const cats = d.select().from(schema.categories).all();
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const byCat = new Map<string, number>();
  let income = 0;
  let expense = 0;
  for (const t of txns) {
    const name = t.categoryId ? catName.get(t.categoryId) || 'Uncategorized' : 'Uncategorized';
    if (t.amount < 0) expense += -t.amount;
    else income += t.amount;
    byCat.set(name, (byCat.get(name) || 0) + t.amount);
  }
  return { byCat, income, expense, count: txns.length };
}

function monthRange(monthsBack: number): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: iso(start), end: iso(end) };
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Insight generation ----
export async function generateInsight(scope: string = 'household', jobId?: string): Promise<{ id: string; content: string }> {
  if (!isAiEnabled()) return { id: '', content: 'AI is disabled or not configured. Set an API key in Settings.' };
  jobStage(jobId, 'Aggregating household data', 1, 3);
  const months = [monthRange(1), monthRange(6)];
  const cur = categoryTotals(months[0].start, months[0].end);
  const hist = categoryTotals(months[1].start, months[1].end);

  const agg = {
    currentMonth: { income: cur.income, expense: cur.expense, byCategory: Object.fromEntries(cur.byCat) },
    trailing6Months: { income: hist.income, expense: hist.expense, byCategory: Object.fromEntries(hist.byCat) },
  };
  jobStage(jobId, 'Generating insight with AI', 2, 3);
  const prompt = `You are a personal finance assistant. Based on the following aggregated household spending data (AUD), write a concise natural-language insight (2-4 sentences) highlighting notable changes, e.g. "You spent 20% more on dining this month than your 6-month average." Be specific and advisory. Data:\n${JSON.stringify(agg)}`;
  const content = await getProvider().chat(prompt, 'You are a concise, friendly household finance advisor.');
  jobStage(jobId, 'Saving insight', 3, 3);
  const id = uid();
  getDb()
    .insert(schema.aiInsights)
    .values({ id, generatedAt: new Date().toISOString(), type: 'insight' as InsightType, scope, content, relatedPeriod: months[0].start })
    .run();
  return { id, content };
}

// ---- Cash-flow forecast (statistical + AI narrative) ----
export function statisticalForecast(categoryId: string | null, monthsAhead = 3): { month: string; projected: number }[] {
  const d = getDb();
  const all = d.select().from(schema.transactions).all().filter((t) => (categoryId ? t.categoryId === categoryId : true));
  // group by month
  const monthly = new Map<string, number>();
  for (const t of all) {
    const m = t.date.slice(0, 7);
    monthly.set(m, (monthly.get(m) || 0) + t.amount);
  }
  const series = [...monthly.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  // 3-month moving average
  const window = series.slice(-3);
  const avg = window.length ? window.reduce((s, v) => s + v, 0) / window.length : 0;
  // simple linear trend from last 6
  const recent = series.slice(-6);
  let trend = 0;
  if (recent.length >= 2) {
    const n = recent.length;
    const xs = recent.map((_, i) => i);
    const ys = recent;
    const xmean = xs.reduce((s, v) => s + v, 0) / n;
    const ymean = ys.reduce((s, v) => s + v, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - xmean) * (ys[i] - ymean), 0);
    const den = xs.reduce((s, x) => s + (x - xmean) ** 2, 0);
    trend = den ? num / den : 0;
  }
  const out: { month: string; projected: number }[] = [];
  const now = new Date();
  for (let i = 1; i <= monthsAhead; i++) {
    const d2 = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push({ month: `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`, projected: Math.round((avg + trend * i) * 100) / 100 });
  }
  return out;
}

export async function generateForecast(scope: string = 'household', jobId?: string): Promise<{ id: string; content: string; projection: { month: string; projected: number }[] }> {
  jobStage(jobId, 'Computing statistical projection', 1, 3);
  const projection = statisticalForecast(null, 3);
  if (!isAiEnabled()) return { id: '', content: 'AI disabled. Showing statistical projection only.', projection };
  jobStage(jobId, 'Generating forecast narrative with AI', 2, 3);
  const prompt = `You are a household finance assistant. Here is a statistical 3-month cash-flow projection (net amount per month, AUD): ${JSON.stringify(projection)}. Write a 2-3 sentence narrative explaining the trend and any cautionary note. Advisory only.`;
  const content = await getProvider().chat(prompt, 'You are a concise household finance forecaster.');
  jobStage(jobId, 'Saving forecast', 3, 3);
  const id = uid();
  getDb()
    .insert(schema.aiInsights)
    .values({ id, generatedAt: new Date().toISOString(), type: 'forecast' as InsightType, scope, content, relatedPeriod: 'next-3-months' })
    .run();
  return { id, content, projection };
}

// ---- Anomaly detection (statistical) ----
export function detectAnomalies(scopeAccountId?: string): { id: string; date: string; description: string; amount: number; categoryId: string | null; reason: string }[] {
  const d = getDb();
  let txns = d.select().from(schema.transactions).all();
  if (scopeAccountId) txns = txns.filter((t) => t.accountId === scopeAccountId);
  // group by category, compute mean/std of expense amounts
  const byCat = new Map<string, number[]>();
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const key = t.categoryId || 'none';
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(-t.amount);
  }
  const stats = new Map<string, { mean: number; std: number }>();
  for (const [k, vals] of byCat) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    stats.set(k, { mean, std });
  }
  const anomalies: { id: string; date: string; description: string; amount: number; categoryId: string | null; reason: string }[] = [];
  for (const t of txns) {
    if (t.amount >= 0) continue;
    const key = t.categoryId || 'none';
    const { mean, std } = stats.get(key) || { mean: 0, std: 0 };
    if (std > 0 && -t.amount > mean + 3 * std && -t.amount > mean * 1.5) {
      anomalies.push({ id: t.id, date: t.date, description: t.description, amount: t.amount, categoryId: t.categoryId, reason: `Unusually large vs category average ($${mean.toFixed(2)})` });
    }
  }
  return anomalies.sort((a, b) => a.amount - b.amount).slice(0, 50);
}

// ---- Subscription / recurring detection ----
export function detectSubscriptions(scopeAccountId?: string): { description: string; amount: number; lastDate: string; nextDate: string; count: number }[] {
  const d = getDb();
  let txns = d.select().from(schema.transactions).all().filter((t) => t.amount < 0);
  if (scopeAccountId) txns = txns.filter((t) => t.accountId === scopeAccountId);
  // group by normalized description + rounded amount
  const groups = new Map<string, { description: string; amount: number; dates: string[] }>();
  for (const t of txns) {
    const key = `${t.description.trim().toLowerCase()}|${(-t.amount).toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, { description: t.description, amount: -t.amount, dates: [] });
    groups.get(key)!.dates.push(t.date);
  }
  const subs: { description: string; amount: number; lastDate: string; nextDate: string; count: number }[] = [];
  for (const g of groups.values()) {
    if (g.dates.length < 3) continue;
    const dates = g.dates.sort();
    // compute median interval
    const intervals: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const days = (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / 86400000;
      intervals.push(days);
    }
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    // recurring if interval roughly 7/14/28/30/365 (±2 days) OR consistent
    const recurring = [7, 14, 28, 30, 31, 365].some((p) => Math.abs(median - p) <= 3) || intervals.every((iv) => Math.abs(iv - median) <= 5);
    if (recurring) {
      const last = dates[dates.length - 1];
      const next = new Date(new Date(last).getTime() + median * 86400000);
      subs.push({
        description: g.description,
        amount: g.amount,
        lastDate: last,
        nextDate: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`,
        count: dates.length,
      });
    }
  }
  return subs.sort((a, b) => b.count - a.count);
}

// ---- Weekly digest (scheduled) ----
export async function runWeeklyDigest(): Promise<void> {
  if (!isAiEnabled()) return;
  await generateInsight('household');
  console.log('[ai] weekly digest generated');
}

export function latestInsight(scope: string = 'household') {
  return getDb()
    .select()
    .from(schema.aiInsights)
    .where(eq(schema.aiInsights.scope, scope))
    .all()
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0];
}

export function testHistory(limit = 10) {
  return getDb()
    .select()
    .from(schema.aiConnectionTestLog)
    .all()
    .sort((a, b) => b.testedAt.localeCompare(a.testedAt))
    .slice(0, limit)
    .map((r) => ({ id: r.id, testedAt: r.testedAt, outcome: r.outcome, latencyMs: r.latencyMs, errorCategory: r.errorCategory }));
}

// ---- Phase 2 §3 — automatic AI categorization on import ----
export interface CategorizeItem {
  id: string; // transaction id (already inserted)
  rawDescription: string;
  amount: number;
}

/** Categorize a batch of uncategorized transactions via AI (Phase 2 §3.2/§3.2b).
 *  - Batches of 25 to reduce round-trips.
 *  - Applies returned categories automatically; sets source='ai_auto', needsReview=true.
 *  - For each, derives a pattern and creates/updates an ai_generated rule.
 *  - Falls back to "Other" with needsReview=true on any failure.
 *  Only sends description + amount (privacy §4.5). Never account numbers/balances.
 *  Returns the number of transactions AI categorized. */
export async function categorizeBatch(
  items: CategorizeItem[],
  batchId: string,
  opts?: { jobId?: string; useWebSearch?: boolean; progressBase?: number; jobTotal?: number },
): Promise<{ categorized: number; aiCalls: number }> {
  const d = getDb();
  const cats = d.select().from(schema.categories).all();
  const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const other = cats.find((c) => c.name === 'Other');
  const catList = cats.map((c) => c.name).join(', ');
  const BATCH = 25;
  let categorized = 0;
  let aiCalls = 0;
  let processed = 0;
  const useWeb = !!opts?.useWebSearch && isAiEnabled();
  const jobTotal = opts?.jobTotal ?? items.length;
  const progressBase = opts?.progressBase ?? 0;
  const report = (stage: string, processedNow: number) => jobStage(opts?.jobId, stage, progressBase + processedNow, jobTotal);

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    aiCalls++;
    // Optional web search to identify the merchant for each unique description.
    // Privacy: search only the sanitized descriptor (no account/ref numbers).
    const webCtx = new Map<string, string>();
    if (useWeb) {
      const uniq = [...new Set(slice.map((it) => sanitizeForAi(it.rawDescription)))];
      report(`Web-searching ${uniq.length} merchant(s) — batch ${Math.floor(i / BATCH) + 1}`, processed);
      for (const desc of uniq) {
        const snippet = await aiWebSearch(`${desc} merchant shop australia`);
        if (snippet) webCtx.set(desc, snippet.slice(0, 400));
      }
    } else {
      report(`AI categorizing batch ${Math.floor(i / BATCH) + 1}`, processed);
    }
    const lines = slice.map((it, idx) => {
      const safe = sanitizeForAi(it.rawDescription);
      const ctx = webCtx.get(safe);
      return ctx
        ? `${idx + 1}. "${safe}" (amount: ${it.amount} AUD) [web context: ${ctx}]`
        : `${idx + 1}. "${safe}" (amount: ${it.amount} AUD)`;
    });
    const prompt = `You are categorizing bank transactions for an Australian household. For each transaction below, choose the single best category from this list: ${catList}. When web context is provided, use it to identify the merchant/shop and infer the category. Reply with one line per transaction in the format "N|category_name" where N is the transaction number. Use ONLY category names from the list.\n\nTransactions:\n${lines.join('\n')}`;
    let parsed: Record<number, string> = {};
    try {
      if (isAiEnabled()) {
        const out = await getProvider().chat(prompt, 'You are a precise transaction categorizer. Reply only with the numbered list, no prose.');
        parsed = parseCategoryResponse(out);
      }
    } catch (e) {
      // batch failed — fall back per-item to Other below
      console.warn('[ai] categorize batch failed', (e as Error).message);
    }

    for (let j = 0; j < slice.length; j++) {
      const it = slice[j];
      const suggestedName = parsed[j + 1];
      const matched = suggestedName ? catByName.get(suggestedName.toLowerCase()) : undefined;
      const categoryId = matched?.id ?? other?.id ?? null;
      const applied = !!(matched);
      d.update(schema.transactions)
        .set({ categoryId, source: 'ai_auto', needsReview: true })
        .where(eq(schema.transactions.id, it.id))
        .run();
      let ruleId: string | null = null;
      if (applied) {
        const pattern = deriveMatchPattern(it.rawDescription);
        const res = createOrUpdateAiRule(pattern, categoryId!);
        ruleId = res.ruleId;
        categorized++;
      }
      d.insert(schema.aiCategorizationLog)
        .values({
          id: uid(),
          transactionId: it.id,
          batchId,
          description: it.rawDescription,
          suggestedCategoryId: categoryId,
          applied,
          ruleCreatedOrUpdatedId: ruleId,
          note: applied ? null : 'fallback: Other',
        })
        .run();
    }
    processed += slice.length;
    report(`Processed ${processed}/${items.length}`, processed);
  }
  return { categorized, aiCalls };
}

/** Re-categorize a set (or all) of transactions against the current rule engine,
 *  then send anything unmatched to AI for categorization (with optional web
 *  search to identify the merchant). Rule-matched transactions are set to
 *  source='rule', needsReview=false; AI-matched to source='ai_auto',
 *  needsReview=true and an ai_generated rule is created/updated. Emits progress
 *  to `jobId` across the whole run. */
export async function recategorizeTransactions(opts: { ids?: string[]; useWebSearch: boolean }, jobId: string): Promise<{
  total: number;
  rulesApplied: number;
  aiCategorized: number;
  aiCalls: number;
}> {
  const d = getDb();
  const rules = getActiveRules();
  let txns = d.select().from(schema.transactions).all();
  if (opts.ids?.length) {
    const idSet = new Set(opts.ids);
    txns = txns.filter((t) => idSet.has(t.id));
  }
  // Privacy: transfers are internal movement, not merchant spend — their memos
  // may contain recipient names/bank strings. Skip them for AI; rule engine
  // still applies (transfer category rules are unaffected).
  txns = txns.filter((t) => !t.isTransfer);
  const total = txns.length;
  if (!total) {
    jobStage(jobId, 'No transactions selected', 0, 0);
    return { total: 0, rulesApplied: 0, aiCategorized: 0, aiCalls: 0 };
  }
  jobStage(jobId, 'Applying current rules', 0, total);
  const unmatched: CategorizeItem[] = [];
  let rulesApplied = 0;
  let i = 0;
  for (const t of txns) {
    const desc = t.rawDescription || t.description;
    const cid = matchRule(desc, t.amount, rules);
    if (cid) {
      d.update(schema.transactions).set({ categoryId: cid, source: 'rule', needsReview: false }).where(eq(schema.transactions.id, t.id)).run();
      rulesApplied++;
    } else {
      unmatched.push({ id: t.id, rawDescription: desc, amount: t.amount });
    }
    i++;
    if (i % 25 === 0) jobStage(jobId, `Applying rules ${i}/${total}`, i, total);
  }
  jobStage(jobId, `Rules matched ${rulesApplied}; ${unmatched.length} need AI`, rulesApplied, total);

  let aiCategorized = 0;
  let aiCalls = 0;
  if (unmatched.length) {
    const r = await categorizeBatch(unmatched, `recategorize-${jobId}`, {
      jobId,
      useWebSearch: opts.useWebSearch,
      progressBase: rulesApplied,
      jobTotal: total,
    });
    aiCategorized = r.categorized;
    aiCalls = r.aiCalls;
  } else {
    jobStage(jobId, 'Nothing needed AI — all matched by rules', total, total);
  }
  return { total, rulesApplied, aiCategorized, aiCalls };
}

function parseCategoryResponse(out: string): Record<number, string> {
  const map: Record<number, string> = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s*[|:\-.)]\s*(.+)$/);
    if (m) map[parseInt(m[1], 10)] = m[2].trim();
  }
  return map;
}

/** Count how many transactions in a candidate import set would need AI (no rule match). */
export function estimateAiNeed(rows: { description: string; amount: number }[]): number {
  const rules = getActiveRules();
  let n = 0;
  for (const r of rows) {
    if (!matchRule(r.description, r.amount, rules)) n++;
  }
  return n;
}

// ---- Phase 2 §8 — 12-month forecast report ----
function isoYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonth(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export async function buildForecastReport(filter?: { accountId?: string[]; memberId?: string[] }, jobId?: string): Promise<{
  history: { month: string; income: number; expense: number; net: number; actual: true }[];
  forecast: { month: string; income: number; expense: number; net: number; cumulative: number; actual: false }[];
  recurring: { description: string; amount: number; monthly: number }[];
  narrative: string;
}> {
  const d = getDb();
  jobStage(jobId, 'Loading transactions', 1, 4);
  let txns = d.select().from(schema.transactions).all().filter((t) => !t.isTransfer);
  if (filter?.accountId?.length) txns = txns.filter((t) => filter.accountId!.includes(t.accountId));

  const accounts = d.select().from(schema.accounts).all();
  const memberIds = filter?.memberId?.length ? [...new Set(filter.memberId)] : [];
  // memberId → ownership-weighted share of each account (capped at 100).
  const memberPct = new Map<string, number>();
  if (memberIds.length) {
    const own = ownershipMap();
    const pool = filter?.accountId?.length
      ? accounts.filter((a) => filter.accountId!.includes(a.id))
      : accounts;
    for (const a of pool) {
      const members = own.get(a.id);
      if (!members) continue;
      let p = 0;
      for (const m of memberIds) p += members.get(m) || 0;
      if (p > 0) memberPct.set(a.id, Math.min(100, p));
    }
    txns = txns.filter((t) => memberPct.has(t.accountId));
  }
  const flowShare = (accountId: string) => (memberIds.length ? (memberPct.get(accountId) || 0) / 100 : 1);

  const now = new Date();
  // Trailing 12 months (including current).
  const histMonths: string[] = [];
  for (let i = 11; i >= 0; i--) histMonths.push(isoYM(addMonth(now, -i)));
  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const m of histMonths) byMonth.set(m, { income: 0, expense: 0 });
  for (const t of txns) {
    const m = t.date.slice(0, 7);
    if (!byMonth.has(m)) continue;
    const e = byMonth.get(m)!;
    const share = flowShare(t.accountId);
    if (t.amount < 0) e.expense += -t.amount * share;
    else e.income += t.amount * share;
  }
  const history = histMonths.map((m) => {
    const e = byMonth.get(m)!;
    return { month: m, income: round2(e.income), expense: round2(e.expense), net: round2(e.income - e.expense), actual: true as const };
  });

  // Recurring items (subscriptions) — fold as fixed monthly line items (§8.2).
  jobStage(jobId, 'Detecting recurring charges', 2, 4);
  const subs = detectSubscriptions();
  const recurring = subs.map((s) => {
    // estimate monthly amount from count over observed window
    const monthly = s.amount; // conservative: treat the recurring charge as the monthly figure
    return { description: s.description, amount: round2(s.amount), monthly: round2(s.amount) };
  });

  // Statistical projection: moving-average + linear trend + simple month seasonality.
  const incomeSeries = history.map((h) => h.income);
  const expenseSeries = history.map((h) => h.expense);
  const netSeries = history.map((h) => h.net);

  const forecast: { month: string; income: number; expense: number; net: number; cumulative: number; actual: false }[] = [];

  // Seed the cumulative balance projection from the ACTUAL current balance
  // (sum of opening balances + all transaction amounts for the scoped accounts,
  // including transfers — money still moves between accounts). The previous
  // seed (last month's net flow) started near 0 and produced a meaningless
  // "end balance" of a few thousand instead of projecting from real net worth.
  const scopedAccts = filter?.accountId?.length
    ? accounts.filter((a) => filter.accountId!.includes(a.id))
    : accounts;
  const balByAccount = new Map<string, number>();
  for (const a of scopedAccts) balByAccount.set(a.id, a.openingBalance);
  for (const t of d.select().from(schema.transactions).all()) {
    if (!balByAccount.has(t.accountId)) continue;
    balByAccount.set(t.accountId, (balByAccount.get(t.accountId) || 0) + t.amount);
  }
  let currentBalance = 0;
  for (const a of scopedAccts) {
    const p = memberPct.has(a.id) ? memberPct.get(a.id)! : filter?.memberId?.length ? 0 : 100;
    currentBalance += (balByAccount.get(a.id) || 0) * p / 100;
  }
  let cumulative = round2(currentBalance);

  for (let i = 1; i <= 12; i++) {
    const d2 = addMonth(now, i);
    const monthKey = isoYM(d2);
    const income = project(incomeSeries, i);
    // Recurring charges are already counted in the historical expense series (and
    // thus in the projection) — adding them again here would double-count.
    const expense = project(expenseSeries, i);
    const net = round2(income - expense);
    cumulative = round2(cumulative + net);
    forecast.push({ month: monthKey, income: round2(income), expense: round2(expense), net, cumulative, actual: false as const });
  }

  // AI narrative (advisory). Computes from numbers; never generates values itself.
  let narrative = 'AI disabled — statistical projection only. Configure an API key in AI Settings for a narrative.';
  try {
    if (isAiEnabled()) {
      jobStage(jobId, 'Generating AI narrative', 3, 4);
      const totalNet = forecast.reduce((s, f) => s + f.net, 0);
      const lowestCum = Math.min(...forecast.map((f) => f.cumulative));
      const prompt = `You are a household finance forecaster. Here is a 12-month forecast (AUD) based on the trailing 12 months of history. Net per month: ${JSON.stringify(forecast.map((f) => f.net))}. Cumulative balance projection: ${JSON.stringify(forecast.map((f) => f.cumulative))}. Total forecast net over 12 months: ${totalNet.toFixed(2)}. Lowest cumulative point: ${lowestCum.toFixed(2)}. Write 2-4 sentences noting key trends (income vs expense), any month the cumulative balance may go negative, and seasonal patterns. Advisory only.`;
      narrative = await getProvider().chat(prompt, 'You are a concise household finance forecaster.');
    }
  } catch (e) {
    narrative = `AI narrative unavailable: ${(e as Error).message}`;
  }
  jobStage(jobId, 'Finalizing report', 4, 4);

  return { history, forecast, recurring, narrative };
}

/** Linear-trend-augmented moving average, with a light seasonality hint from same-month last year. */
function project(series: number[], ahead: number): number {
  if (!series.length) return 0;
  const recent = series.slice(-6);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  // linear trend over last 6
  let trend = 0;
  if (recent.length >= 2) {
    const n = recent.length;
    const xs = recent.map((_, i) => i);
    const xmean = xs.reduce((s, v) => s + v, 0) / n;
    const ymean = recent.reduce((s, v) => s + v, 0) / n;
    const num = xs.reduce((s, x, i) => s + (x - xmean) * (recent[i] - ymean), 0);
    const den = xs.reduce((s, x) => s + (x - xmean) ** 2, 0);
    trend = den ? num / den : 0;
  }
  // seasonality: same month one year ago (12 months back from the forecast month = series index ahead-1)
  const seasonal = series[series.length - 12 + ((ahead - 1) % 12)] ?? avg;
  return Math.max(0, Math.round((0.5 * (avg + trend * ahead) + 0.5 * seasonal) * 100) / 100);
}

// ---- AI Budget Assistant (generate / suggest monthly budgets) ----
// Household-level (all accounts at 100%). Sends only per-category spend aggregates
// + current budgets + generic AU cost-of-living web-search context to the model —
// never raw transactions, account numbers, or balances (privacy §4.5).
function bMonthStart(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function bMonthEnd(d: Date): string {
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`;
}
function bAddMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

interface BudgetSuggestion {
  categoryId: string;
  categoryName: string;
  suggestedMonthlyAmount: number;
  reason: string;
}

/** Per-category spend stats over the trailing 24 months for expense categories.
 *  Includes only categories with spend history or an existing budget (skips
 *  never-used categories to avoid hallucinated budgets). */
function budgetCategoryStats() {
  const d = getDb();
  const txns = d.select().from(schema.transactions).all();
  const cats = d.select().from(schema.categories).all();
  const budgets = d.select().from(schema.categoryBudgets).all();
  const budgetByCat = new Map(budgets.map((b) => [b.categoryId, b.monthlyAmount]));

  const transferCatIds = new Set(cats.filter((c) => c.type === 'transfer').map((c) => c.id));
  const isTransferLike = (t: { isTransfer: boolean; categoryId: string | null }) =>
    t.isTransfer || (t.categoryId != null && transferCatIds.has(t.categoryId));

  const now = new Date();
  const start = bMonthStart(bAddMonths(now, -23));
  const end = bMonthEnd(now);
  const inRange = (date: string) => date >= start && date <= end;

  // month index 0..23 keyed YYYY-MM
  const monthKeys: string[] = [];
  for (let i = 23; i >= 0; i--) {
    const ms = bAddMonths(now, -i);
    monthKeys.push(`${ms.getFullYear()}-${String(ms.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthIdx = new Map(monthKeys.map((k, i) => [k, i]));

  // catName -> per-month expense array (length 24)
  const byCat = new Map<string, number[]>();
  for (const c of cats) byCat.set(c.name, new Array(24).fill(0));

  for (const t of txns) {
    if (!inRange(t.date)) continue;
    if (t.amount >= 0) continue; // expenses only
    if (isTransferLike(t)) continue;
    const cat = cats.find((c) => c.id === t.categoryId);
    const name = cat ? cat.name : 'Uncategorized';
    if (!byCat.has(name)) byCat.set(name, new Array(24).fill(0));
    const month = t.date.slice(0, 7);
    const idx = monthIdx.get(month);
    if (idx == null) continue;
    byCat.get(name)![idx] += -t.amount;
  }

  const stats: {
    categoryName: string;
    categoryId: string;
    avgMonthly: number;
    recent3Avg: number;
    priorAvg: number;
    trendPct: number | null;
    monthsWithSpend: number;
    currentBudget: number | null;
  }[] = [];
  for (const c of cats) {
    if (c.type === 'income' || c.type === 'transfer') continue;
    const arr = byCat.get(c.name) || new Array(24).fill(0);
    const monthsWithSpend = arr.filter((v) => v > 0).length;
    const currentBudget = budgetByCat.has(c.id) ? budgetByCat.get(c.id)! : null;
    if (monthsWithSpend === 0 && currentBudget == null) continue; // skip never-used + unset
    const sum = arr.reduce((s, v) => s + v, 0);
    const avgMonthly = round2(sum / 24);
    const recent3 = arr.slice(-3);
    const recent3Sum = recent3.reduce((s, v) => s + v, 0);
    const recent3Avg = round2(recent3Sum / 3);
    const prior = arr.slice(0, 21);
    const priorSum = prior.reduce((s, v) => s + v, 0);
    const priorAvg = round2(priorSum / 21);
    const trendPct = priorAvg > 0 ? Math.round(((recent3Avg - priorAvg) / priorAvg) * 1000) / 10 : null;
    stats.push({ categoryName: c.name, categoryId: c.id, avgMonthly, recent3Avg, priorAvg, trendPct, monthsWithSpend, currentBudget });
  }
  return { stats, budgetByCat, cats };
}

/** Parse a JSON array of budget suggestions from model output, tolerating
 *  code fences / surrounding prose. Returns [] on failure. */
function parseBudgetSuggestions(raw: string): { categoryName: string; suggestedMonthlyAmount: number; reason: string }[] {
  let s = (raw || '').trim();
  // strip code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end < 0 || end <= start) return [];
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.categoryName === 'string' && typeof x.suggestedMonthlyAmount === 'number')
      .map((x) => ({ categoryName: String(x.categoryName), suggestedMonthlyAmount: Math.max(0, Number(x.suggestedMonthlyAmount) || 0), reason: typeof x.reason === 'string' ? x.reason : '' }));
  } catch {
    return [];
  }
}

export async function generateBudgets(jobId?: string): Promise<{
  applied: { categoryId: string; categoryName: string; monthlyAmount: number }[];
  changes: { categoryId: string; categoryName: string; previous: number | null; new: number; reason: string }[];
  narrative: string;
}> {
  if (!isAiEnabled()) {
    return { applied: [], changes: [], narrative: 'AI is disabled or not configured. Set an API key in AI & Insights settings.' };
  }
  jobStage(jobId, 'Aggregating 24 months of spending', 1, 4);
  const { stats, budgetByCat, cats } = budgetCategoryStats();

  jobStage(jobId, 'Researching AU cost of living', 2, 4);
  const marketContext = (
    await Promise.all([
      aiWebSearch('Australia cost of living 2026 household expenses'),
      aiWebSearch('Australia CPI inflation rate 2026 ABS quarterly'),
      aiWebSearch('RBA interest rates household budget 2026'),
    ])
  ).filter(Boolean).join('\n---\n');

  jobStage(jobId, 'Generating budget suggestions with AI', 3, 4);
  const system =
    'You are an expert personal finance advisor for Australian households. You have deep knowledge of the Australian cost of living, the ABS Consumer Price Index, Reserve Bank of Australia interest rates, and typical household budgeting benchmarks. All amounts are in AUD. You reason about essential vs discretionary spending and adjust budgets for current Australian economic conditions (inflation, cost-of-living pressure).';
  const prompt = `You are planning monthly budgets for an Australian household. Below is per-category spend data over the trailing 24 months (AUD), each category's current monthly budget (null = none set yet), and recent AU cost-of-living market research.

For EACH category, propose a sensible monthly budget in AUD. For categories with no budget yet, generate one based on their spend history and current AU conditions. For categories with an existing budget, suggest a revised amount based on recent spend trends and the market research (increase if costs are rising, decrease if spending has fallen, or keep stable).

Respond with STRICT JSON ONLY — an array of objects, no prose, no code fences:
[{ "categoryName": "<name>", "suggestedMonthlyAmount": <number>, "reason": "<one short sentence why, referencing trend or AU conditions>" }]

Categories data:
${JSON.stringify(stats)}

Current AU market research context:
${marketContext || '(no web search results available — rely on the spend history and your knowledge of current AU conditions)'}`;

  const raw = await getProvider().chat(prompt, system);
  const parsed = parseBudgetSuggestions(raw);

  jobStage(jobId, 'Applying budgets', 4, 4);
  const d = getDb();
  const nameById = new Map(cats.map((c) => [c.name, c.id]));
  const applied: { categoryId: string; categoryName: string; monthlyAmount: number }[] = [];
  const changes: { categoryId: string; categoryName: string; previous: number | null; new: number; reason: string }[] = [];

  for (const s of parsed) {
    const categoryId = nameById.get(s.categoryName);
    if (!categoryId) {
      console.warn('[ai] budget suggestion: no category named', s.categoryName);
      continue;
    }
    const monthlyAmount = Math.round(s.suggestedMonthlyAmount * 100) / 100;
    const previous = budgetByCat.has(categoryId) ? budgetByCat.get(categoryId)! : null;
    const existing = d.select().from(schema.categoryBudgets).where(eq(schema.categoryBudgets.categoryId, categoryId)).get();
    if (existing) {
      d.update(schema.categoryBudgets).set({ monthlyAmount }).where(eq(schema.categoryBudgets.id, existing.id)).run();
    } else {
      d.insert(schema.categoryBudgets).values({ id: uid(), categoryId, monthlyAmount }).run();
    }
    budgetByCat.set(categoryId, monthlyAmount);
    applied.push({ categoryId, categoryName: s.categoryName, monthlyAmount });
    changes.push({ categoryId, categoryName: s.categoryName, previous, new: monthlyAmount, reason: s.reason });
  }

  const narrative = parsed.length === 0
    ? 'AI returned no budget suggestions. Try again or set budgets manually.'
    : `Applied ${applied.length} budget suggestion${applied.length === 1 ? '' : 's'} based on 24 months of history and current AU cost-of-living research.`;
  return { applied, changes, narrative };
}