import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { bootstrap } from './bootstrap.js';
import { getDb, schema } from './index.js';
import { DEFAULT_CATEGORIES } from '@homefinance/shared';

/** Idempotently create the implicit household + default categories. Safe to call on every boot. */
export function seedDefaults() {
  bootstrap();
  const db = getDb();
  const existingHh = db.select().from(schema.households).all();
  if (existingHh.length === 0) {
    db.insert(schema.households).values({ id: randomUUID(), name: 'Our Household' }).run();
  }
  const existingCats = db.select().from(schema.categories).all();
  const existingNames = new Set(existingCats.map((c) => c.name));
  let added = 0;
  for (const c of DEFAULT_CATEGORIES) {
    if (!existingNames.has(c.name)) {
      db.insert(schema.categories).values({ id: randomUUID(), name: c.name, isCustom: false }).run();
      added++;
    }
  }
  return { categories: db.select().from(schema.categories).all().length, added };
}

// When run directly as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = seedDefaults();
    console.log('[seed] done. categories:', r.categories, 'added:', r.added);
  } catch (e) {
    console.error('[seed] failed', e);
    process.exit(1);
  }
}