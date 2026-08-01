import { getDb, schema } from '../db/index.js';
import type { RuleMatchType } from '@homefinance/shared';

export interface RuleRow {
  id: string;
  matchType: RuleMatchType;
  matchValue: string;
  amountMin: number | null;
  amountMax: number | null;
  categoryId: string;
  priority: number;
  isActive: boolean;
}

export function getActiveRules(): RuleRow[] {
  return getDb()
    .select()
    .from(schema.rules)
    .all()
    .filter((r) => r.isActive)
    .sort((a, b) => a.priority - b.priority);
}

/** Returns categoryId if a rule matches the given description + amount, else null. */
export function matchRule(
  description: string,
  amount: number,
  rules: RuleRow[] = getActiveRules(),
): string | null {
  const desc = description.toLowerCase();
  for (const rule of rules) {
    if (!matchText(rule, desc)) continue;
    if (!matchAmount(rule, amount)) continue;
    return rule.categoryId;
  }
  return null;
}

function matchText(rule: RuleRow, desc: string): boolean {
  switch (rule.matchType) {
    case 'contains':
      return desc.includes(rule.matchValue.toLowerCase());
    case 'equals':
      return desc === rule.matchValue.toLowerCase();
    case 'regex':
      try {
        return new RegExp(rule.matchValue, 'i').test(desc);
      } catch {
        return false;
      }
    case 'amount_range':
      return true; // amount handled in matchAmount
    default:
      return false;
  }
}

function matchAmount(rule: RuleRow, amount: number): boolean {
  if (rule.matchType === 'amount_range') {
    const abs = Math.abs(amount);
    if (rule.amountMin != null && abs < rule.amountMin) return false;
    if (rule.amountMax != null && abs > rule.amountMax) return false;
    return true;
  }
  // For text rules, optional amount filters further refine.
  if (rule.amountMin != null && Math.abs(amount) < rule.amountMin) return false;
  if (rule.amountMax != null && Math.abs(amount) > rule.amountMax) return false;
  return true;
}

/** Test a rule against existing transactions; returns count of matches. */
export function countRuleMatches(rule: Omit<RuleRow, 'id' | 'priority' | 'isActive'>): number {
  const all = getDb().select().from(schema.transactions).all();
  let n = 0;
  for (const t of all) {
    if (matchText({ ...rule, matchType: rule.matchType } as RuleRow, t.description.toLowerCase())) {
      if (matchAmount({ ...rule, matchType: rule.matchType } as RuleRow, t.amount)) n++;
    }
  }
  return n;
}