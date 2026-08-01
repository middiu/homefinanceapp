import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import { uid } from '../utils.js';
import type { RuleMatchType, RuleSource } from '@homefinance/shared';

export interface RuleRow {
  id: string;
  matchType: RuleMatchType;
  matchValue: string;
  amountMin: number | null;
  amountMax: number | null;
  categoryId: string;
  priority: number;
  isActive: boolean;
  ruleSource: RuleSource;
}

export function getActiveRules(): RuleRow[] {
  return getDb()
    .select()
    .from(schema.rules)
    .all()
    .filter((r) => r.isActive)
    .map((r) => ({
      id: r.id,
      matchType: r.matchType as RuleMatchType,
      matchValue: r.matchValue,
      amountMin: r.amountMin,
      amountMax: r.amountMax,
      categoryId: r.categoryId,
      priority: r.priority,
      isActive: r.isActive,
      ruleSource: (r.ruleSource as RuleSource) ?? 'manual',
    }))
    .sort((a, b) => a.priority - b.priority);
}

/** Returns categoryId if a rule matches the given description + amount, else null.
 *  Rule matching operates on the raw bank description (Phase 2 §10). */
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

function matchText(rule: Pick<RuleRow, 'matchType' | 'matchValue'>, desc: string): boolean {
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
  if (rule.amountMin != null && Math.abs(amount) < rule.amountMin) return false;
  if (rule.amountMax != null && Math.abs(amount) > rule.amountMax) return false;
  return true;
}

/** Test a rule against existing transactions; returns count of matches. */
export function countRuleMatches(rule: Omit<RuleRow, 'id' | 'priority' | 'isActive' | 'ruleSource'>): number {
  const all = getDb().select().from(schema.transactions).all();
  let n = 0;
  for (const t of all) {
    if (matchText({ ...rule, matchType: rule.matchType } as RuleRow, t.description.toLowerCase())) {
      if (matchAmount({ ...rule, matchType: rule.matchType } as RuleRow, t.amount)) n++;
    }
  }
  return n;
}

/** Derive a `contains` match pattern from a raw bank description (Phase 2 §3.2b / §10).
 *  Strips trailing reference numbers, dates, store numbers and card refs while keeping
 *  the recognisable merchant text. Returns a lowercased pattern. */
export function deriveMatchPattern(rawDescription: string): string {
  let s = rawDescription.trim();
  // Strip leading card-prefixes like "CARD XXXX1234", "VISA DEBIT", "EFTPOS"
  s = s.replace(/^(card|visa|mastercard|eftpos|pos|dep|dd|bp|bpay|direct (credit|debit))[\s\d*]+/i, '');
  // Strip trailing reference/store numbers: "COLES 1234 SYDNEY" -> keep words, drop trailing digits + city often
  // Remove standalone runs of 3+ digits (transaction ids, store numbers)
  s = s.replace(/\b\d{3,}\b/g, ' ');
  // Remove common reference tokens
  s = s.replace(/\b(ref|reference|txn|transaction|id|seq|au|aus|nsw|vic|qld|wa|sa|tas|act|nt|syd|melb|bris|perth|adel|hobart|darwin)\b/gi, ' ');
  // Collapse whitespace, trim
  s = s.replace(/\s+/g, ' ').trim();
  // If the result has multiple words, keep first 2-3 distinctive tokens (merchant core)
  const tokens = s.split(' ').filter((w) => w.length >= 2);
  const pattern = tokens.slice(0, 3).join(' ');
  // Fallback to first non-numeric token if cleaning removed everything
  return (pattern || rawDescription.trim().split(/\s+/).find((w) => /[a-z]{2,}/i.test(w)) || rawDescription.trim()).toLowerCase();
}

/** Priority band helpers (Phase 2 §3.2b / §9.2). Lower priority = matched first. */
export const PRIORITY_BAND = { manualMax: 999, aiGeneratedMin: 2000, aiGeneratedMax: 2999, seededGenericMin: 3000 };

/** Create or update an AI-generated rule for a pattern (Phase 2 §3.2b).
 *  - If an AI-generated rule already matches this pattern with a different category, update it + log.
 *  - Never overwrites a manual or seeded rule.
 *  - New AI rules get priority in the ai_generated band (after manual, before seeded generic).
 *  Returns { ruleId, created: boolean, updatedFromCategory?: string }. */
export function createOrUpdateAiRule(pattern: string, categoryId: string): { ruleId: string; created: boolean; updatedFromCategory?: string } {
  const d = getDb();
  const lowerPattern = pattern.toLowerCase();
  // Find an existing AI-generated rule with this exact matchValue.
  const existing = d
    .select()
    .from(schema.rules)
    .all()
    .find((r) => (r.ruleSource ?? 'manual') === 'ai_generated' && r.matchValue.toLowerCase() === lowerPattern && r.isActive);

  if (existing) {
    if (existing.categoryId === categoryId) {
      return { ruleId: existing.id, created: false };
    }
    const oldCatId = existing.categoryId;
    d.update(schema.rules)
      .set({ categoryId, updatedFromAiAt: new Date().toISOString() })
      .where(eq(schema.rules.id, existing.id))
      .run();
    return { ruleId: existing.id, created: false, updatedFromCategory: oldCatId };
  }

  // Place new AI rule at the top of the ai_generated band (after manual, before seeded generic).
  const aiRules = d.select().from(schema.rules).all().filter((r) => (r.ruleSource ?? 'manual') === 'ai_generated');
  const maxAiPrio = aiRules.length ? Math.max(...aiRules.map((r) => r.priority)) : PRIORITY_BAND.aiGeneratedMin - 1;
  const priority = Math.min(PRIORITY_BAND.aiGeneratedMax, maxAiPrio + 1);
  const id = uid();
  d.insert(schema.rules)
    .values({
      id,
      matchType: 'contains',
      matchValue: lowerPattern,
      amountMin: null,
      amountMax: null,
      categoryId,
      priority,
      isActive: true,
      ruleSource: 'ai_generated',
    })
    .returning()
    .get();
  return { ruleId: id, created: true };
}