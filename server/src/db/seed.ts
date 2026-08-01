import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { bootstrap } from './bootstrap.js';
import { getDb, schema } from './index.js';
import { DEFAULT_CATEGORIES, allSeedRules, SEED_RULES_VERSION } from '@homefinance/shared';

/** Idempotently create the implicit household, default categories, and seed rules.
 *  Safe to call on every boot. Phase 2 backfills category.type and seeds default rules
 *  once per seed version (never re-inserted/duplicated on restart). */
export function seedDefaults() {
  bootstrap();
  const d = getDb();

  // 1) household
  const existingHh = d.select().from(schema.households).all();
  if (existingHh.length === 0) {
    d.insert(schema.households).values({ id: randomUUID(), name: 'Our Household' }).run();
  }

  // 2) default categories (+ Phase 2 §7.3 type + essential backfill)
  const existingCats = d.select().from(schema.categories).all();
  const existingNames = new Set(existingCats.map((c) => c.name));
  const catNameToType = new Map(DEFAULT_CATEGORIES.map((c) => [c.name, c.type]));
  const catNameToEssential = new Map(
    DEFAULT_CATEGORIES.map((c) => [c.name, c.essential ?? null] as [string, boolean | null]),
  );
  let catAdded = 0;
  for (const c of DEFAULT_CATEGORIES) {
    if (!existingNames.has(c.name)) {
      d.insert(schema.categories)
        .values({ id: randomUUID(), name: c.name, isCustom: false, type: c.type, essential: c.essential ?? null })
        .run();
      catAdded++;
    }
  }
  // Backfill type on existing categories still missing it (legacy Phase 1 rows).
  const allCats = d.select().from(schema.categories).all();
  const catByName = new Map(allCats.map((c) => [c.name, c]));
  for (const c of allCats) {
    if (c.type == null) {
      const t = catNameToType.get(c.name) ?? (c.name === 'Income' ? 'income' : c.name === 'Transfers' ? 'transfer' : 'expense');
      d.update(schema.categories).set({ type: t }).where(eq(schema.categories.id, c.id)).run();
    }
  }
  // Backfill essential on existing default categories still untagged (preserves user edits).
  for (const c of allCats) {
    if (c.essential == null && catNameToEssential.has(c.name)) {
      const e = catNameToEssential.get(c.name)!;
      d.update(schema.categories).set({ essential: e }).where(eq(schema.categories.id, c.id)).run();
    }
  }

  // 3) seed default rules — one-time per version (Phase 2 §9). Never re-insert.
  const rulesAdded = seedRules(d, catByName);

  return {
    categories: d.select().from(schema.categories).all().length,
    categoriesAdded: catAdded,
    rules: d.select().from(schema.rules).all().length,
    rulesAdded,
    seedVersion: SEED_RULES_VERSION,
  };
}

function seedRules(d: ReturnType<typeof getDb>, catByName: Map<string, { id: string }>) {
  const already = d.select().from(schema.seedRulesApplied).where(eq(schema.seedRulesApplied.seedVersion, SEED_RULES_VERSION)).get();
  if (already) return 0;

  let added = 0;
  const seed = allSeedRules();
  let merchantPrio = 1000;
  let genericPrio = 3000;
  for (const r of seed) {
    const cat = catByName.get(r.category);
    if (!cat) continue; // category missing — skip
    const prio = r.tier === 'merchant' ? merchantPrio++ : genericPrio++;
    d.insert(schema.rules)
      .values({
        id: randomUUID(),
        matchType: r.matchType,
        matchValue: r.matchValue,
        categoryId: cat.id,
        priority: prio,
        isActive: true,
        ruleSource: 'seeded',
        seedVersion: SEED_RULES_VERSION,
        amountMin: null,
        amountMax: null,
      })
      .run();
    added++;
  }
  d.insert(schema.seedRulesApplied).values({ seedVersion: SEED_RULES_VERSION, count: added }).run();
  return added;
}

// When run directly as a script.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const r = seedDefaults();
    console.log('[seed] done. categories:', r.categories, 'added:', r.categoriesAdded, 'rules:', r.rules, 'added:', r.rulesAdded, 'seedVersion:', r.seedVersion);
  } catch (e) {
    console.error('[seed] failed', e);
    process.exit(1);
  }
}