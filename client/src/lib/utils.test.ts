import { describe, it, expect } from 'vitest';
import { formatAUD, formatDate, monthLabel, pct } from './utils';

describe('client formatting (en-AU / AUD)', () => {
  it('formats AUD with currency and 2dp', () => {
    const s = formatAUD(1234.5);
    expect(s).toContain('1,234.50');
    expect(s).toMatch(/AUD|\$/);
  });
  it('formats dates DD/MM/YYYY', () => {
    expect(formatDate('2026-07-01')).toBe('01/07/2026');
    expect(formatDate(null)).toBe('');
  });
  it('labels months with year', () => {
    expect(monthLabel('2026-07')).toContain('26');
  });
  it('formats percentage deltas', () => {
    expect(pct(12.5)).toBe('+12.5%');
    expect(pct(-5)).toBe('-5.0%');
    expect(pct(null)).toBe('—');
  });
});