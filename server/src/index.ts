import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import cron from 'node-cron';
import { config } from './config.js';
import { bootstrap } from './db/bootstrap.js';
import { seedDefaults } from './db/seed.js';
import membersRouter from './routes/members.js';
import accountsRouter from './routes/accounts.js';
import categoriesRouter from './routes/categories.js';
import rulesRouter from './routes/rules.js';
import transactionsRouter from './routes/transactions.js';
import importsRouter from './routes/imports.js';
import dashboardsRouter from './routes/dashboards.js';
import aiRouter from './routes/ai.js';
import settingsRouter from './routes/settings.js';
import backupsRouter from './routes/backups.js';
import investmentsRouter from './routes/investments.js';
import reportsRouter from './routes/reports.js';
import { runWeeklyDigest } from './services/ai.js';
import { backupDb } from './services/backup.js';
import { snapshotPrice } from './services/investments.js';
import { linkTransfers } from './services/transfers.js';
import { getDb, schema } from './db/index.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(morgan('dev'));

// Ensure DB tables exist on boot.
bootstrap();
const seeded = seedDefaults();
console.log(`[db] seeded: ${seeded.categories} categories, ${seeded.rules} rules (added ${seeded.rulesAdded} @ ${seeded.seedVersion})`);

// Link any existing credit-card <-> repayment transfer pairs (Phase 2 §2).
try {
  const linked = linkTransfers();
  if (linked) console.log(`[db] linked ${linked} transfer pair(s)`);
} catch (e) {
  console.warn('[db] transfer linking on boot failed', (e as Error).message);
}

// Daily price snapshot job for held tickers (Phase 2 §4.2). Runs once a day at 18:00.
const heldTickers = () => {
  try {
    const rows = getDb().select().from(schema.investmentHoldings).all();
    return Array.from(new Set(rows.map((r) => r.ticker)));
  } catch {
    return [];
  }
};
cron.schedule('0 18 * * *', async () => {
  for (const t of heldTickers()) {
    try {
      await snapshotPrice(t);
    } catch (e) {
      console.warn('[cron] price snapshot failed for', t, (e as Error).message);
    }
  }
});
console.log('[cron] daily investment price snapshot scheduled: 0 18 * * *');

const api = express.Router();
api.use('/members', membersRouter);
api.use('/accounts', accountsRouter);
api.use('/categories', categoriesRouter);
api.use('/rules', rulesRouter);
api.use('/transactions', transactionsRouter);
api.use('/imports', importsRouter);
api.use('/dashboards', dashboardsRouter);
api.use('/ai', aiRouter);
api.use('/settings', settingsRouter);
api.use('/backups', backupsRouter);
api.use('/investments', investmentsRouter);
api.use('/reports', reportsRouter);
app.use('/api', api);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Serve built client in production (single-container deployment).
const clientDist = path.resolve(config.clientDist);
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] error', err);
  res.status(500).json({ error: (err as Error).message });
});

// ---- Schedulers ----
if (config.ai.enabled && config.ai.digestCron) {
  cron.schedule(config.ai.digestCron, () => {
    runWeeklyDigest().catch((e) => console.error('[cron] weekly digest failed', e));
  });
  console.log(`[cron] weekly AI digest scheduled: ${config.ai.digestCron}`);
}
if (config.backup.cron) {
  cron.schedule(config.backup.cron, () => {
    backupDb().catch((e) => console.error('[cron] backup failed', e));
  });
  console.log(`[cron] daily DB backup scheduled: ${config.backup.cron}`);
}

const server = app.listen(config.port, () => {
  console.log(`[server] HomeFinance API listening on http://localhost:${config.port}`);
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

export { app };