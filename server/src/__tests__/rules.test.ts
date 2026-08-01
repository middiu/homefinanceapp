import { describe, it, expect, beforeAll } from 'vitest';
import { setupDb, getDb, schema, randomUUID } from './dbHelper.js';
import { matchRule, getActiveRules } from '../services/rules.js';
import { uid } from '../utils.js';

let groceriesId: string;
let inactiveRuleId: string;

beforeAll(() => {
  setupDb();
  const db = getDb();
  groceriesId = uid();
  db.insert(schema.categories).values({ id: groceriesId, name: 'Groceries', isCustom: false }).run();
  // a rule to test: contains woolworths
  db.insert(schema.rules)
    .values({ id: uid(), matchType: 'contains', matchValue: 'woolworths', categoryId: groceriesId, priority: 10, isActive: true })
    .run();
  db.insert(schema.rules)
    .values({ id: uid(), matchType: 'regex', matchValue: '^netflix', categoryId: groceriesId, priority: 20, isActive: true })
    .run();
  // inactive rule should be ignored
  inactiveRuleId = uid();
  db.insert(schema.rules)
    .values({ id: inactiveRuleId, matchType: 'equals', matchValue: 'coles-test-inactive', categoryId: groceriesId, priority: 5, isActive: false })
    .run();
  // amount range rule
  db.insert(schema.rules)
    .values({ id: uid(), matchType: 'amount_range', matchValue: '', amountMin: 1000, amountMax: null, categoryId: groceriesId, priority: 30, isActive: true })
    .run();
});

describe('rule engine', () => {
  it('matches a contains rule', () => {
    expect(matchRule('WOOLWORTHS 1234 SYDNEY', -85.2)).toBe(groceriesId);
  });
  it('matches a regex rule', () => {
    expect(matchRule('NETFLIX MONTHLY', -19.99)).toBe(groceriesId);
  });
  it('ignores inactive rules', () => {
    // the inactive rule must not appear in the active set
    const rules = getActiveRules();
    expect(rules.find((r) => r.id === inactiveRuleId)).toBeUndefined();
  });
  it('matches amount_range rules on absolute amount', () => {
    expect(matchRule('BIG SALARY', 5000)).toBe(groceriesId);
    expect(matchRule('small', 50)).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(matchRule('UNKNOWN MERCHANT', -10)).toBeNull();
  });
  it('respects priority order (lowest priority first)', () => {
    const rules = getActiveRules();
    const prios = rules.map((r) => r.priority);
    expect(prios).toEqual([...prios].sort((a, b) => a - b));
  });
});