import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid, round2 } from '../utils.js';
import type { HoldingAggregate, PortfolioSummary } from '@homefinance/shared';

// Phase 2 §4 — Yahoo Finance price lookup + caching.
// Unofficial, undocumented endpoint (documented as an accepted risk in /docs/decisions).
// Cache: in-memory price + timestamp per ticker; refreshed if older than PRICE_TTL_MS.
const PRICE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const priceCache = new Map<string, { price: number; currency: string; at: number }>();

export interface LivePrice {
  ticker: string;
  price: number;
  currency: string;
  stale: boolean;
}

export async function fetchPrice(ticker: string): Promise<LivePrice | null> {
  const cached = priceCache.get(ticker);
  if (cached && Date.now() - cached.at < PRICE_TTL_MS) {
    return { ticker, price: cached.price, currency: cached.currency, stale: false };
  }
  try {
    // query1.finance.yahoo.com v8 chart endpoint (unofficial).
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'HomeFinance/1.0' } });
    if (!resp.ok) return lastKnown(ticker);
    const data = (await resp.json()) as any;
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    if (!meta) return lastKnown(ticker);
    const price = meta.regularMarketPrice ?? meta.previousClose;
    const currency = meta.currency || (ticker.toUpperCase().endsWith('.AX') ? 'AUD' : 'USD');
    priceCache.set(ticker, { price, currency, at: Date.now() });
    return { ticker, price, currency, stale: false };
  } catch {
    return lastKnown(ticker);
  }
}

function lastKnown(ticker: string): LivePrice | null {
  const cached = priceCache.get(ticker);
  if (cached) return { ticker, price: cached.price, currency: cached.currency, stale: true };
  // fall back to latest stored snapshot
  const snap = getDb()
    .select()
    .from(schema.priceSnapshots)
    .where(eq(schema.priceSnapshots.ticker, ticker))
    .all()
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
  if (snap) return { ticker, price: snap.price, currency: snap.currency, stale: true };
  return null;
}

/** Fetch + persist a daily snapshot for a ticker (used by the scheduled job). */
export async function snapshotPrice(ticker: string, dateStr?: string): Promise<void> {
  const live = await fetchPrice(ticker);
  if (!live) return;
  const d = getDb();
  const date = dateStr ?? todayISO();
  const existing = d.select().from(schema.priceSnapshots).where(eq(schema.priceSnapshots.ticker, ticker)).all().find((s) => s.snapshotDate === date);
  if (existing) {
    d.update(schema.priceSnapshots).set({ price: live.price, currency: live.currency, fetchedAt: new Date().toISOString() }).where(eq(schema.priceSnapshots.id, existing.id)).run();
  } else {
    d.insert(schema.priceSnapshots).values({ id: uid(), ticker, price: live.price, currency: live.currency, snapshotDate: date }).run();
  }
}

export function listHoldings(accountId?: string) {
  const d = getDb();
  let rows = d.select().from(schema.investmentHoldings).all();
  if (accountId) rows = rows.filter((h) => h.accountId === accountId);
  return rows.map((h) => ({
    id: h.id,
    accountId: h.accountId,
    ticker: h.ticker,
    purchaseDate: h.purchaseDate,
    quantity: h.quantity,
    purchasePrice: h.purchasePrice,
    fees: h.fees ?? null,
    importBatchId: h.importBatchId ?? null,
    createdAt: h.createdAt,
  }));
}

export async function portfolioSummary(accountId?: string): Promise<PortfolioSummary> {
  const holdings = listHoldings(accountId);
  if (!holdings.length) {
    return { totalValue: 0, totalCost: 0, totalGain: 0, totalGainPct: null, holdings: [], allocation: [], trend: [], stale: false };
  }
  const tickers = Array.from(new Set(holdings.map((h) => h.ticker)));
  const prices = await Promise.all(tickers.map((t) => fetchPrice(t)));
  const priceByTicker = new Map<string, LivePrice>();
  for (const p of prices) if (p) priceByTicker.set(p.ticker, p);

  const byTicker = new Map<string, HoldingAggregate>();
  let totalValue = 0;
  let totalCost = 0;
  let stale = false;
  for (const h of holdings) {
    const live = priceByTicker.get(h.ticker);
    if (!live || live.stale) stale = true;
    const price = live?.price ?? null;
    const cost = round2(h.quantity * h.purchasePrice + (h.fees ?? 0));
    totalCost += cost;
    const value = price != null ? round2(h.quantity * price) : null;
    if (value != null) totalValue += value;
    const agg = byTicker.get(h.ticker) ?? {
      ticker: h.ticker,
      quantity: 0,
      avgCost: 0,
      cost: 0,
      currentPrice: price,
      currentPriceAt: live ? new Date(live.stale ? 0 : Date.now()).toISOString() : null,
      currency: live?.currency ?? null,
      value: null,
      gain: null,
      gainPct: null,
      lots: [],
    };
    agg.quantity += h.quantity;
    agg.cost = round2(agg.cost + cost);
    if (value != null) agg.value = round2((agg.value ?? 0) + value);
    agg.lots.push(h);
    byTicker.set(h.ticker, agg);
  }
  for (const agg of byTicker.values()) {
    agg.avgCost = agg.quantity ? round2(agg.cost / agg.quantity) : 0;
    if (agg.value != null) {
      agg.gain = round2(agg.value - agg.cost);
      agg.gainPct = agg.cost ? Math.round(((agg.value - agg.cost) / agg.cost) * 1000) / 10 : null;
    }
  }
  const holdingsAgg = [...byTicker.values()].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const allocation = holdingsAgg
    .filter((h) => h.value != null)
    .map((h) => ({ ticker: h.ticker, value: h.value! }))
    .sort((a, b) => b.value - a.value);

  // trend from daily snapshots: portfolio value over time vs cost line
  const trend = await buildTrend(tickers, holdings, priceByTicker);

  const totalGain = round2(totalValue - totalCost);
  const totalGainPct = totalCost ? Math.round(((totalValue - totalCost) / totalCost) * 1000) / 10 : null;
  return {
    totalValue: round2(totalValue),
    totalCost: round2(totalCost),
    totalGain,
    totalGainPct,
    holdings: holdingsAgg,
    allocation,
    trend,
    stale,
  };
}

async function buildTrend(
  tickers: string[],
  holdings: ReturnType<typeof listHoldings>,
  priceByTicker: Map<string, LivePrice>,
): Promise<{ date: string; value: number; cost: number }[]> {
  const d = getDb();
  // gather all snapshot dates
  const snaps = d.select().from(schema.priceSnapshots).all().filter((s) => tickers.includes(s.ticker));
  if (!snaps.length) {
    // single point: today, value=cost (no history)
    const cost = round2(holdings.reduce((s, h) => s + h.quantity * h.purchasePrice + (h.fees ?? 0), 0));
    return [{ date: todayISO(), value: cost, cost }];
  }
  const dates = Array.from(new Set(snaps.map((s) => s.snapshotDate))).sort();
  // For each date, sum quantity_held * price for each ticker (use snapshot if available else last known before date).
  const out: { date: string; value: number; cost: number }[] = [];
  const totalCost = round2(holdings.reduce((s, h) => s + h.quantity * h.purchasePrice + (h.fees ?? 0), 0));
  for (const date of dates) {
    let value = 0;
    for (const t of tickers) {
      const qty = holdings.filter((h) => h.ticker === t).reduce((s, h) => s + h.quantity, 0);
      const snap = snaps.filter((s) => s.ticker === t && s.snapshotDate <= date).sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate))[0];
      if (snap) value += qty * snap.price;
    }
    out.push({ date, value: round2(value), cost: totalCost });
  }
  return out;
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}