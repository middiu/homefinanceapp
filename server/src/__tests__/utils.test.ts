import { describe, it, expect } from 'vitest';
import { parseAmount, parseDate, dedupHash, round2 } from '../utils.js';

describe('parseAmount', () => {
  it('handles plain numbers and strings', () => {
    expect(parseAmount(12.34)).toBe(12.34);
    expect(parseAmount('12.34')).toBe(12.34);
    expect(parseAmount('1234.56')).toBe(1234.56);
  });
  it('strips currency and spaces', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount(' $ 99.99 ')).toBe(99.99);
  });
  it('handles European decimal comma', () => {
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('12,50')).toBe(12.5);
  });
  it('treats single comma as decimal when 1-2 digits after', () => {
    expect(parseAmount('9,99')).toBe(9.99);
  });
  it('treats single comma as thousands when 3 digits after', () => {
    expect(parseAmount('1,000')).toBe(1000);
  });
  it('returns null for garbage', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });
  it('handles negative values', () => {
    expect(parseAmount('-85.20')).toBe(-85.2);
    expect(parseAmount('-$1,200')).toBe(-1200);
  });
});

describe('parseDate', () => {
  it('parses DD/MM/YYYY (en-AU default)', () => {
    expect(parseDate('01/07/2026')).toBe('2026-07-01');
    expect(parseDate('31-12-2026')).toBe('2026-12-31');
  });
  it('parses 2-digit years', () => {
    expect(parseDate('1/7/26')).toBe('2026-07-01');
    expect(parseDate('1/7/99')).toBe('1999-07-01');
  });
  it('passes through ISO', () => {
    expect(parseDate('2026-07-01')).toBe('2026-07-01');
    expect(parseDate('2026-07-01T10:00:00')).toBe('2026-07-01');
  });
  it('parses YYYYMMDD', () => {
    expect(parseDate('20260701')).toBe('2026-07-01');
  });
  it('uses MM/DD when format indicates US', () => {
    expect(parseDate('07/01/2026', 'MM/dd/yyyy')).toBe('2026-07-01');
  });
  it('returns null for unparseable', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('not a date')).toBeNull();
  });
});

describe('dedupHash', () => {
  it('is stable for identical normalized input', () => {
    const h1 = dedupHash('acct', '2026-07-01', -85.2, 'WOOLWORTHS 1234');
    const h2 = dedupHash('acct', '2026-07-01', -85.2, '  woolworths   1234 ');
    expect(h1).toBe(h2);
  });
  it('differs by amount', () => {
    const h1 = dedupHash('acct', '2026-07-01', -85.2, 'X');
    const h2 = dedupHash('acct', '2026-07-01', -85.3, 'X');
    expect(h1).not.toBe(h2);
  });
  it('differs by account', () => {
    expect(dedupHash('a', '2026-07-01', 1, 'X')).not.toBe(dedupHash('b', '2026-07-01', 1, 'X'));
  });
});

describe('round2', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.345)).toBe(2.35);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});