import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { uid, round2 } from '../utils.js';
import { eq } from 'drizzle-orm';
import type { InsightType } from '@homefinance/shared';
import { OLLAMA_CLOUD_MODELS } from '@homefinance/shared';
import { matchRule, deriveMatchPattern, createOrUpdateAiRule, getActiveRules } from './rules.js';

// ---- Provider abstraction (§3.5 / §4.1) ----
// Default: Ollama Cloud (OpenAI-compatible /chat/completions). Swappable via config.
interface AiProvider {
  chat(prompt: string, system?: string): Promise<string>;
}

function getSetting(key: string): string | null {
  const r = getDb().select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return r ? r.value : null;
}

function aiConfig() {
  return {
    enabled: getSetting('ai.enabled') !== 'false' && config.ai.enabled,
    baseUrl: getSetting('ai.baseUrl') || config.ai.baseUrl,
    apiKey: getSetting('ai.apiKey') || config.ai.apiKey,
    model: getSetting('ai.model') || config.ai.model,
  };
}

export function isAiEnabled(): boolean {
  return aiConfig().enabled && !!aiConfig().apiKey;
}

/** Phase 2 §3.2 — separate toggle for automatic per-import AI categorization. */
export function isAutoCategorizeEnabled(): boolean {
  const raw = getSetting('ai.autoCategorize');
  if (raw !== null) return raw === 'true';
  // default: on when a key is configured
  return isAiEnabled();
}

class OllamaCloudProvider implements AiProvider {
  async chat(prompt: string, system?: string): Promise<string> {
    const cfg = aiConfig();
    if (!cfg.enabled || !cfg.apiKey) throw new Error('AI not configured (missing API key or disabled)');
    const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ];
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({ model: cfg.model, messages, stream: false }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`AI provider error ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await resp.json()) as any;
    return data?.choices?.[0]?.message?.content?.trim() || '';
  }
}

export function getProvider(): AiProvider {
  return new OllamaCloudProvider();
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
export async function generateInsight(scope: string = 'household'): Promise<{ id: string; content: string }> {
  if (!isAiEnabled()) return { id: '', content: 'AI is disabled or not configured. Set an API key in Settings.' };
  const months = [monthRange(1), monthRange(6)];
  const cur = categoryTotals(months[0].start, months[0].end);
  const hist = categoryTotals(months[1].start, months[1].end);

  const agg = {
    currentMonth: { income: cur.income, expense: cur.expense, byCategory: Object.fromEntries(cur.byCat) },
    trailing6Months: { income: hist.income, expense: hist.expense, byCategory: Object.fromEntries(hist.byCat) },
  };
  const prompt = `You are a personal finance assistant. Based on the following aggregated household spending data (AUD), write a concise natural-language insight (2-4 sentences) highlighting notable changes, e.g. "You spent 20% more on dining this month than your 6-month average." Be specific and advisory. Data:\n${JSON.stringify(agg)}`;
  const content = await getProvider().chat(prompt, 'You are a concise, friendly household finance advisor.');
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

export async function generateForecast(scope: string = 'household'): Promise<{ id: string; content: string; projection: { month: string; projected: number }[] }> {
  const projection = statisticalForecast(null, 3);
  if (!isAiEnabled()) return { id: '', content: 'AI disabled. Showing statistical projection only.', projection };
  const prompt = `You are a household finance assistant. Here is a statistical 3-month cash-flow projection (net amount per month, AUD): ${JSON.stringify(projection)}. Write a 2-3 sentence narrative explaining the trend and any cautionary note. Advisory only.`;
  const content = await getProvider().chat(prompt, 'You are a concise household finance forecaster.');
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

// ---- Phase 2 §5 — connector: cloud model list ----
/** Fetch available models from the provider's /models endpoint, filtered to the
 *  cloud-hosted allow-list (§5.2). Returns model identifiers. */
export async function listCloudModels(): Promise<{ models: string[]; raw?: any[]; error?: string }> {
  const cfg = aiConfig();
  if (!cfg.apiKey) return { models: [], error: 'No API key configured' };
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/models`;
  try {
    const resp = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${cfg.apiKey}` } });
    if (!resp.ok) {
      return { models: [], error: `Model list fetch failed (${resp.status})` };
    }
    const data = (await resp.json()) as any;
    const raw: any[] = data?.data ?? data?.models ?? [];
    const ids: string[] = raw.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    // Filter to cloud-hosted allow-list (§5.2) — keep order of allow-list, only those present.
    const present = new Set(ids.map((id) => id.toLowerCase()));
    const filtered = OLLAMA_CLOUD_MODELS.filter((m) => present.has(m.toLowerCase()));
    // Also include any returned ids that exactly match an allow-list entry (case-insensitive).
    return { models: filtered.length ? filtered : ids.filter((id) => OLLAMA_CLOUD_MODELS.map((m) => m.toLowerCase()).includes(id.toLowerCase())), raw: ids };
  } catch (e) {
    return { models: [], error: (e as Error).message };
  }
}

// ---- Phase 2 §5.3 — connection troubleshooting ----
export async function testConnection(override?: { baseUrl?: string; apiKey?: string }): Promise<{
  ok: boolean;
  latencyMs: number | null;
  errorCategory: 'auth' | 'network' | 'url' | 'unexpected' | null;
  message: string;
  models?: string[];
  testedAt: string;
}> {
  const cfg = aiConfig();
  const baseUrl = (override?.baseUrl ?? (cfg.baseUrl || '')).trim();
  const apiKey = override?.apiKey ?? cfg.apiKey;
  const testedAt = new Date().toISOString();
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, latencyMs: null, errorCategory: 'url', message: 'Base URL must start with http:// or https://', testedAt };
  }
  if (!apiKey) {
    return { ok: false, latencyMs: null, errorCategory: 'auth', message: 'No API key configured', testedAt };
  }
  const start = Date.now();
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } });
    const latencyMs = Date.now() - start;
    if (resp.status === 401 || resp.status === 403) {
      await logTest('failure', latencyMs, 'auth');
      return { ok: false, latencyMs, errorCategory: 'auth', message: `Authentication failed (${resp.status}). Check your API key.`, testedAt };
    }
    if (!resp.ok) {
      await logTest('failure', latencyMs, 'unexpected');
      return { ok: false, latencyMs, errorCategory: 'unexpected', message: `Unexpected response: HTTP ${resp.status}`, testedAt };
    }
    const data = (await resp.json()) as any;
    const raw: any[] = data?.data ?? data?.models ?? [];
    const ids: string[] = raw.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
    const present = new Set(ids.map((id) => id.toLowerCase()));
    const models = OLLAMA_CLOUD_MODELS.filter((m) => present.has(m.toLowerCase()));
    await logTest('success', latencyMs, null);
    return { ok: true, latencyMs, errorCategory: null, message: `Connection OK. ${models.length} cloud model(s) available.`, models, testedAt };
  } catch (e) {
    const latencyMs = Date.now() - start;
    const msg = (e as Error).message;
    const category = /ENOTFOUND|ECONNREFUSED|fetch failed|network|timeout/i.test(msg) ? 'network' : 'unexpected';
    await logTest('failure', latencyMs, category);
    return { ok: false, latencyMs, errorCategory: category as any, message: msg, testedAt };
  }
}

async function logTest(outcome: 'success' | 'failure', latencyMs: number, errorCategory: string | null) {
  try {
    getDb().insert(schema.aiConnectionTestLog).values({ id: uid(), outcome, latencyMs, errorCategory }).run();
  } catch {
    /* ignore logging failures */
  }
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
export async function categorizeBatch(items: CategorizeItem[], batchId: string): Promise<{ categorized: number; aiCalls: number }> {
  const d = getDb();
  const cats = d.select().from(schema.categories).all();
  const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c]));
  const other = cats.find((c) => c.name === 'Other');
  const catList = cats.map((c) => c.name).join(', ');
  const BATCH = 25;
  let categorized = 0;
  let aiCalls = 0;

  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    aiCalls++;
    const lines = slice.map((it, idx) => `${idx + 1}. "${it.rawDescription}" (amount: ${it.amount} AUD)`);
    const prompt = `You are categorizing bank transactions for an Australian household. For each transaction below, choose the single best category from this list: ${catList}. Reply with one line per transaction in the format "N|category_name" where N is the transaction number. Use ONLY category names from the list.\n\nTransactions:\n${lines.join('\n')}`;
    let parsed: Record<number, string> = {};
    let batchOk = false;
    try {
      if (isAiEnabled()) {
        const out = await getProvider().chat(prompt, 'You are a precise transaction categorizer. Reply only with the numbered list, no prose.');
        parsed = parseCategoryResponse(out);
        batchOk = true;
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
  }
  return { categorized, aiCalls };
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

export async function buildForecastReport(filter?: { accountId?: string[]; memberId?: string[] }): Promise<{
  history: { month: string; income: number; expense: number; net: number; actual: true }[];
  forecast: { month: string; income: number; expense: number; net: number; cumulative: number; actual: false }[];
  recurring: { description: string; amount: number; monthly: number }[];
  narrative: string;
}> {
  const d = getDb();
  let txns = d.select().from(schema.transactions).all().filter((t) => !t.isTransfer);
  if (filter?.accountId?.length) txns = txns.filter((t) => filter.accountId!.includes(t.accountId));

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
    if (t.amount < 0) e.expense += -t.amount;
    else e.income += t.amount;
  }
  const history = histMonths.map((m) => {
    const e = byMonth.get(m)!;
    return { month: m, income: round2(e.income), expense: round2(e.expense), net: round2(e.income - e.expense), actual: true as const };
  });

  // Recurring items (subscriptions) — fold as fixed monthly line items (§8.2).
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
  let cumulative = history[history.length - 1]?.net ?? 0;
  for (let i = 1; i <= 12; i++) {
    const d2 = addMonth(now, i);
    const monthKey = isoYM(d2);
    const income = project(incomeSeries, i);
    let expense = project(expenseSeries, i);
    // Add recurring fixed amounts to expense.
    for (const r of recurring) expense += r.monthly;
    const net = round2(income - expense);
    cumulative = round2(cumulative + net);
    forecast.push({ month: monthKey, income: round2(income), expense: round2(expense), net, cumulative, actual: false as const });
  }

  // AI narrative (advisory). Computes from numbers; never generates values itself.
  let narrative = 'AI disabled — statistical projection only. Configure an API key in AI Settings for a narrative.';
  try {
    if (isAiEnabled()) {
      const totalNet = forecast.reduce((s, f) => s + f.net, 0);
      const lowestCum = Math.min(...forecast.map((f) => f.cumulative));
      const prompt = `You are a household finance forecaster. Here is a 12-month forecast (AUD) based on the trailing 12 months of history. Net per month: ${JSON.stringify(forecast.map((f) => f.net))}. Cumulative balance projection: ${JSON.stringify(forecast.map((f) => f.cumulative))}. Total forecast net over 12 months: ${totalNet.toFixed(2)}. Lowest cumulative point: ${lowestCum.toFixed(2)}. Write 2-4 sentences noting key trends (income vs expense), any month the cumulative balance may go negative, and seasonal patterns. Advisory only.`;
      narrative = await getProvider().chat(prompt, 'You are a concise household finance forecaster.');
    }
  } catch (e) {
    narrative = `AI narrative unavailable: ${(e as Error).message}`;
  }

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