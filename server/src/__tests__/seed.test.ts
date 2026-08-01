import { describe, it, expect, beforeAll } from 'vitest';
import { setupDb, getDb, schema } from './dbHelper.js';
import { seedDefaults } from '../db/seed.js';
import { allSeedRules, SEED_RULES_VERSION } from '@homefinance/shared';

// Seed idempotency: re-running seedDefaults must NOT duplicate rules or re-insert
// for the same version (seed_rules_applied guards one-time insertion).
describe('seed versioning (M14)', () => {
  beforeAll(() => setupDb());

  it('inserts default categories + seed rules on first run', () => {
    seedDefaults();
    const db = getDb();
    const cats = db.select().from(schema.categories).all();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.some((c) => c.name === 'Groceries')).toBe(true);
    const rules = db.select().from(schema.rules).all();
    // at least the merchant seed rules should be present
    expect(rules.filter((r) => (r as any).ruleSource === 'seeded').length).toBeGreaterThan(0);
  });

  it('does not duplicate seed rules on a second seedDefaults call', () => {
    const before = getDb().select().from(schema.rules).all().length;
    seedDefaults();
    const after = getDb().select().from(schema.rules).all().length;
    expect(after).toBe(before);
  });

  it('records the applied seed version exactly once', () => {
    const rows = getDb().select().from(schema.seedRulesApplied).all();
    expect(rows.length).toBe(1);
    expect(rows[0].seedVersion).toBe(SEED_RULES_VERSION);
  });

  it('the seed pack contains the expected merchant tiers', () => {
    const all = allSeedRules();
    expect(all.some((r) => r.tier === 'merchant')).toBe(true);
    expect(all.some((r) => r.tier === 'generic')).toBe(true);
  });
});