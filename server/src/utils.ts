import { randomUUID, createHash } from 'node:crypto';

export const uid = () => randomUUID();

// Dedup hash: account + ISO date + amount (2dp) + description (lowercased, trimmed)
export function dedupHash(accountId: string, date: string, amount: number, description: string): string {
  const norm = description.trim().toLowerCase().replace(/\s+/g, ' ');
  const amt = amount.toFixed(2);
  return createHash('sha256').update(`${accountId}|${date}|${amt}|${norm}`).digest('hex');
}

// AUD money formatting (en-AU). Returns plain number for DB; formatting done client-side.
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Parse a possibly-locale-formatted number ("1.234,56" or "1,234.56" or "1234.56").
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/[$\s]/g, '');
  // If both separators present, the last one is decimal.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      // European: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US/AU: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (lastComma > -1 && lastDot === -1) {
    // Ambiguous single comma -> treat as decimal if 1-2 digits after, else thousands.
    const after = s.length - lastComma - 1;
    s = after <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Normalize a date string into yyyy-mm-dd. Returns null if unparseable.
export function parseDate(raw: unknown, fmt?: string | null): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) return toISO(raw);
  let s = String(raw).trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const sepMatch = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (sepMatch) {
    // Determine month-first vs day-first from format hint. Default (en-AU) = day-first.
    const order = fmt ? fmt.replace(/[^mdy]/gi, '').toLowerCase() : '';
    const monthFirst = order.startsWith('m') && order.indexOf('d') > order.indexOf('m');
    let first = parseInt(sepMatch[1], 10);
    let second = parseInt(sepMatch[2], 10);
    let y = sepMatch[3];
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? '19' : '20') + y;
    const m = monthFirst ? first : second;
    const d = monthFirst ? second : first;
    // sanity: if monthFirst but first>12, fall back to day-first
    if (monthFirst && first > 12 && second <= 12) {
      return `${y}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  // YYYYMMDD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  // Fallback: Date.parse
  const t = Date.parse(s);
  if (!isNaN(t)) return toISO(new Date(t));
  return null;
}

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}