import { describe, it, expect } from 'vitest';
import { formatAUD, formatDate, monthLabel, pct, localISODate, overviewRange, apiErrorMessage } from './utils';

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
  it('uses the local calendar date', () => {
    expect(localISODate(new Date(2026, 10, 2, 6, 55))).toBe('2026-11-02');
  });
  it('maps overview presets to inclusive month ranges', () => {
    const now = new Date(2026, 10, 2);
    expect(overviewRange('current', now)).toEqual({ dateFrom: '2026-11-01', dateTo: '2026-11-30' });
    expect(overviewRange('3', now)).toEqual({ dateFrom: '2026-09-01', dateTo: '2026-11-30' });
    expect(overviewRange('ytd', now)).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-11-30' });
  });
  it('reads a string error from an RTK payload', () => {
    expect(apiErrorMessage({ data: { error: 'nope' } })).toBe('nope');
    expect(apiErrorMessage({ message: 'Rejected' }, 'fallback')).toBe('fallback');
  });
});