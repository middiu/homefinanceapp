import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { backupDb, listBackups } from '../services/backup.js';

const router = Router();

// Create a backup now.
router.post('/', async (_req, res) => {
  const dest = await backupDb();
  res.status(201).json({ ok: true, file: path.basename(dest) });
});

router.get('/', (_req, res) => {
  res.json(listBackups());
});

// Download a backup file.
router.get('/:name/download', (req, res) => {
  const dir = path.resolve(config.backup.dir);
  const file = path.join(dir, path.basename(req.params.name));
  if (!file.startsWith(dir) || !fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  res.download(file);
});

router.delete('/:name', (req, res) => {
  const dir = path.resolve(config.backup.dir);
  const file = path.join(dir, path.basename(req.params.name));
  if (!file.startsWith(dir) || !fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
  fs.unlinkSync(file);
  res.status(204).end();
});

export default router;