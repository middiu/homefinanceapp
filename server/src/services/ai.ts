import { getDb, schema } from '../db/index.js';
import { config } from '../config.js';
import { uid } from '../utils.js';
import { eq } from 'drizzle-orm';
import type { InsightType } from '@homefinance/shared';

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