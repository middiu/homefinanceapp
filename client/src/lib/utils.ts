import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// en-AU AUD currency formatting
const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });

export function formatAUD(n: number): string {
  return aud.format(n);
}

export function formatAUDSigned(n: number): string {
  const s = aud.format(Math.abs(n));
  return n < 0 ? `-${s}` : n > 0 ? `+${s}` : s;
}

// DD/MM/YYYY from yyyy-mm-dd
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return iso;
}

export function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

export function pct(n: number | null): string {
  if (n == null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

// Distinct chart palette
export const CHART_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
  '#84cc16',
  '#06b6d4',
  '#a855f7',
];