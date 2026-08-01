import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid, parseAmount, parseDate } from '../utils.js';
import { listHoldings, portfolioSummary, snapshotPrice, fetchPrice } from '../services/investments.js';
import { parseCsv } from '../services/parsers.js';
import type { InvestmentHoldingDto } from '@homefinance/shared';
import multer from 'multer';

const router = Router();
const db = () => getDb();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function mapH(h: any): InvestmentHoldingDto {
  return {
    id: h.id,
    accountId: h.accountId,
    ticker: h.ticker,
    purchaseDate: h.purchaseDate,
    quantity: h.quantity,
    purchasePrice: h.purchasePrice,
    fees: h.fees ?? null,
    importBatchId: h.importBatchId ?? null,
    createdAt: h.createdAt,
  };
}

// Portfolio summary (optionally scoped to one investment account).
router.get('/portfolio', async (req, res) => {
  const accountId = (req.query.accountId as string) || undefined;
  try {
    const summary = await portfolioSummary(accountId);
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// List holdings for an account.
router.get('/holdings', (req, res) => {
  const accountId = (req.query.accountId as string) || undefined;
  res.json(listHoldings(accountId).map(mapH));
});

const holdingSchema = z.object({
  accountId: z.string(),
  ticker: z.string().min(1),
  purchaseDate: z.string(),
  quantity: z.number().positive(),
  purchasePrice: z.number().positive(),
  fees: z.number().nullish(),
});

router.post('/holdings', (req, res) => {
  const parsed = holdingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.investmentHoldings)
    .values({
      id: uid(),
      accountId: parsed.data.accountId,
      ticker: parsed.data.ticker.toUpperCase(),
      purchaseDate: parsed.data.purchaseDate,
      quantity: parsed.data.quantity,
      purchasePrice: parsed.data.purchasePrice,
      fees: parsed.data.fees ?? null,
    })
    .returning()
    .get();
  res.status(201).json(mapH(r));
});

router.delete('/holdings/:id', (req, res) => {
  db().delete(schema.investmentHoldings).where(eq(schema.investmentHoldings.id, req.params.id)).run();
  res.status(204).end();
});

// Phase 2 §4.2 — CSV holdings import with column mapping (ticker, purchase_date, quantity, price, fees).
router.post('/holdings/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const accountId = req.body.accountId as string;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });
  const columnMap = req.body.columnMap ? JSON.parse(req.body.columnMap) : null;
  const parsed = parseCsv(req.file.buffer, { hasHeader: req.body.hasHeader !== 'false' });
  const batchId = uid();
  const get = (row: Record<string, string>, field: string) => {
    if (!columnMap) return row[field] ?? '';
    const col = columnMap[field];
    return col ? row[col] ?? '' : '';
  };
  let inserted = 0;
  const d = getDb();
  for (const r of parsed.rows) {
    const ticker = (get(r.raw, 'ticker') || get(r.raw, 'symbol')).trim().toUpperCase();
    if (!ticker) continue;
    const date = parseDate(get(r.raw, 'date') || get(r.raw, 'purchase_date'));
    const quantity = parseAmount(get(r.raw, 'quantity'));
    const price = parseAmount(get(r.raw, 'price') || get(r.raw, 'purchase_price'));
    if (!date || quantity == null || price == null) continue;
    const fees = parseAmount(get(r.raw, 'fees') || get(r.raw, 'brokerage'));
    d.insert(schema.investmentHoldings)
      .values({ id: uid(), accountId, ticker, purchaseDate: date, quantity, purchasePrice: price, fees: fees ?? null, importBatchId: batchId })
      .run();
    inserted++;
  }
  // refresh prices for newly imported tickers
  res.status(201).json({ batchId, inserted });
});

// Manual price refresh for one ticker.
router.post('/price/refresh', async (req, res) => {
  const ticker = (req.body.ticker as string)?.toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  const p = await fetchPrice(ticker);
  if (!p) return res.status(404).json({ error: 'price unavailable' });
  await snapshotPrice(ticker);
  res.json(p);
});

export default router;