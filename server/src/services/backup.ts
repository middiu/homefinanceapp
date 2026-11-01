import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getSqlite } from '../db/index.js';

export async function backupDb(): Promise<string> {
  const dir = path.resolve(config.backup.dir);
  fs.mkdirSync(dir, { recursive: true });
  const sqlite = getSqlite();
  // Checkpoint WAL into the main db first.
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dir, `homefinance-${stamp}.sqlite`);
  // Copy the main db file (better-sqlite3 backup API). Await completion so
  // callers and retention see a finished file, and a failed copy is not pruned around.
  const src = path.resolve(config.databaseUrl);
  if (!fs.existsSync(src)) throw new Error(`db file not found: ${src}`);
  await sqlite.backup(dest);
  console.log('[backup] created', dest);
  // Prune old backups beyond keep count.
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('homefinance-') && f.endsWith('.sqlite'))
    .sort()
    .reverse();
  for (const f of files.slice(config.backup.keep)) {
    fs.unlinkSync(path.join(dir, f));
  }
  return dest;
}

export function listBackups(): { name: string; size: number; mtime: string }[] {
  const dir = path.resolve(config.backup.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('homefinance-') && f.endsWith('.sqlite'))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}