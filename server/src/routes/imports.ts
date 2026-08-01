import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { getSqlite } from '../db/index.js';
import { uid, dedupHash } from '../utils.js';
import { parseFile, mapCsvRow, type ParsedRow } from '../services/parsers.js';
import { matchRule } from '../services/rules.js';
import { categorizeBatch, estimateAiNeed, isAutoCategorizeEnabled } from '../services/ai.js';
import { linkTransfers } from '../services/transfers.js';
import type { ImportBatchDto, ImportFileFormat, ImportMappingDto } from '@homefinance/shared';

const router = Router();
const db = () => getDb();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Upload + parse -> preview (no DB writes). Detects duplicates against existing txns.
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file uploaded' });
  const format = (req.body.format || inferFormat(req.file.originalname)) as ImportFileFormat;
  if (!['csv', 'ofx', 'qif'].includes(format)) return res.status(400).json({ error: 'unsupported format' });

  let parsed;
  try {
    parsed = parseFile(req.file.buffer, format, {
      hasHeader: req.body.hasHeader !== 'false',
      amountSignConvention: (req.body.amountSignConvention as any) || 'auto',
    });
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message });
  }

  // For CSV, apply column mapping if provided.
  let rows = parsed.rows;
  let columnMap: Record<string, string | null> | null = null;
  if (format === 'csv' && req.body.columnMap) {
    try {
      columnMap = JSON.parse(req.body.columnMap);
      rows = rows.map((r) =>
        mapCsvRow(r.raw, columnMap!, (req.body.amountSignConvention as any) || 'auto', req.body.dateFormat || null),
      );
    } catch {
      return res.status(400).json({ error: 'invalid columnMap JSON' });
    }
  }

  // Ofx/Qif rows already parsed with date+amount+description.

  // Dedup detection: compute hashes, check against existing.
  const accountId = req.body.accountId as string;
  if (!accountId) return res.status(400).json({ error: 'accountId required' });

  const hashes = rows.map((r) => (r.date ? dedupHash(accountId, r.date, r.amount, r.description) : ''));
  const existing = new Set(
    db()
      .select({ h: schema.transactions.dedupHash })
      .from(schema.transactions)
      .where(inArray(schema.transactions.dedupHash, hashes.filter(Boolean)))
      .all()
      .map((x) => x.h),
  );

  const preview = rows.map((r, i) => ({
    index: i,
    date: r.date,
    description: r.description,
    amount: r.amount,
    balance: r.balance,
    isDuplicate: !!hashes[i] && existing.has(hashes[i]),
    categoryId: r.date ? matchRule(r.description, r.amount) : null, // suggested
  }));

  res.json({
    format,
    headers: parsed.headers,
    rows: preview,
    accountId,
    fileName: req.file.originalname,
    columnMap,
  });
});

// Estimate how many of an upload's rows would need AI categorization (Phase 2 §3.4).
// Re-uses the parsed rows passed from /upload preview.
router.post('/estimate-ai', (req, res) => {
  const parsed = z
    .object({ rows: z.array(z.object({ description: z.string(), amount: z.number() })) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const need = estimateAiNeed(parsed.data.rows);
  res.json({ needAi: need, total: parsed.data.rows.length, autoCategorize: isAutoCategorizeEnabled() });
});

// Commit an import given previously-uploaded parsed rows.
const commitSchema = z.object({
  accountId: z.string(),
  format: z.enum(['csv', 'ofx', 'qif']),
  fileName: z.string(),
  rows: z.array(
    z.object({
      date: z.string().nullable(),
      description: z.string(),
      amount: z.number(),
      balance: z.number().nullish(),
      isDuplicate: z.boolean().optional(),
    }),
  ),
  applyRules: z.boolean().default(true),
  autoCategorize: z.boolean().optional(), // override the settings toggle
  // for CSV
  columnMap: z.record(z.string(), z.string().nullish()).optional(),
});

router.post('/commit', async (req, res) => {
  const parsed = commitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { accountId, format, fileName, rows, applyRules } = parsed.data;

  const d = getDb();
  const batchId = uid();
  let inserted = 0;
  let duplicates = 0;
  const insertedIds: { id: string; rawDescription: string; amount: number }[] = [];

  const run = getSqlite().transaction(() => {
    d.insert(schema.importBatches)
      .values({
        id: batchId,
        accountId,
        fileName,
        fileFormat: format,
        rowCount: rows.length,
        duplicateCount: 0,
      })
      .run();

    for (const r of rows) {
      if (!r.date) continue; // skip unparseable
      const hash = dedupHash(accountId, r.date, r.amount, r.description);
      const exists = d.select({ id: schema.transactions.id }).from(schema.transactions).where(eq(schema.transactions.dedupHash, hash)).get();
      if (exists) {
        duplicates++;
        continue;
      }
      const categoryId = applyRules ? matchRule(r.description, r.amount) : null;
      const source = categoryId ? 'rule' : 'manual';
      const id = uid();
      d.insert(schema.transactions)
        .values({
          id,
          accountId,
          date: r.date,
          description: r.description,
          rawDescription: r.description,
          amount: r.amount,
          balance: r.balance ?? null,
          categoryId,
          source,
          importBatchId: batchId,
          isTransfer: false,
          needsReview: false,
          dedupHash: hash,
        })
        .run();
      inserted++;
      // collect rows that rules couldn't categorize — candidates for AI.
      if (!categoryId) insertedIds.push({ id, rawDescription: r.description, amount: r.amount });
    }
    d.update(schema.importBatches).set({ duplicateCount: duplicates }).where(eq(schema.importBatches.id, batchId)).run();
  });
  run();

  // Phase 2 §3.2 — AI auto-categorize any rows rules couldn't handle.
  let aiCategorized = 0;
  const doAuto = parsed.data.autoCategorize !== undefined ? parsed.data.autoCategorize : isAutoCategorizeEnabled();
  if (doAuto && insertedIds.length) {
    try {
      const r = await categorizeBatch(insertedIds, batchId);
      aiCategorized = r.categorized;
    } catch (e) {
      console.warn('[import] AI categorization failed (import still completes)', (e as Error).message);
    }
    d.update(schema.importBatches).set({ aiCategorizedCount: aiCategorized }).where(eq(schema.importBatches.id, batchId)).run();
  }

  // Phase 2 §2 — detect transfer pairs (credit card <-> repayment) for this account's pairs.
  try {
    linkTransfers();
  } catch (e) {
    console.warn('[import] transfer linking failed', (e as Error).message);
  }

  res.status(201).json({ batchId, inserted, duplicates, aiCategorized, total: rows.length });
});

function mapBatch(r: typeof schema.importBatches.$inferSelect): ImportBatchDto {
  return {
    id: r.id,
    accountId: r.accountId,
    importedAt: r.importedAt,
    fileName: r.fileName,
    fileFormat: r.fileFormat as ImportFileFormat,
    rowCount: r.rowCount,
    duplicateCount: r.duplicateCount,
    aiCategorizedCount: r.aiCategorizedCount ?? 0,
  };
}

router.get('/batches', (_req, res) => {
  res.json(db().select().from(schema.importBatches).all().sort((a, b) => b.importedAt.localeCompare(a.importedAt)).map(mapBatch));
});

// Undo an import batch: delete all transactions created in it.
router.delete('/batches/:id', (req, res) => {
  db().delete(schema.transactions).where(eq(schema.transactions.importBatchId, req.params.id)).run();
  db().delete(schema.importBatches).where(eq(schema.importBatches.id, req.params.id)).run();
  res.status(204).end();
});

// ---- Import mapping templates ----
router.get('/mappings', (_req, res) => {
  res.json(
    db()
      .select()
      .from(schema.importMappings)
      .all()
      .map((m) => ({
        id: m.id,
        name: m.name,
        accountId: m.accountId,
        format: m.format as ImportFileFormat,
        columnMap: JSON.parse(m.columnMap),
        hasHeader: m.hasHeader,
        dateFormat: m.dateFormat,
        amountSignConvention: m.amountSignConvention,
      })),
  );
});

const mappingSchema = z.object({
  name: z.string().min(1),
  accountId: z.string().nullish(),
  format: z.enum(['csv', 'ofx', 'qif']),
  columnMap: z.record(z.string(), z.string().nullish()),
  hasHeader: z.boolean().default(true),
  dateFormat: z.string().nullish(),
  amountSignConvention: z.enum(['auto', 'negIsExpense', 'posIsExpense']).default('auto'),
});

router.post('/mappings', (req, res) => {
  const parsed = mappingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const r = db()
    .insert(schema.importMappings)
    .values({ id: uid(), name: parsed.data.name, accountId: parsed.data.accountId ?? null, format: parsed.data.format, columnMap: JSON.stringify(parsed.data.columnMap), hasHeader: parsed.data.hasHeader, dateFormat: parsed.data.dateFormat ?? null, amountSignConvention: parsed.data.amountSignConvention })
    .returning()
    .get();
  res.status(201).json({ id: r.id, ...parsed.data });
});

router.delete('/mappings/:id', (req, res) => {
  db().delete(schema.importMappings).where(eq(schema.importMappings.id, req.params.id)).run();
  res.status(204).end();
});

function inferFormat(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) return 'ofx';
  if (lower.endsWith('.qif')) return 'qif';
  return 'csv';
}

export default router;