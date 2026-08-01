import Papa from 'papaparse';
import { parseAmount, parseDate, parseTime } from '../utils.js';
import type { ImportFileFormat } from '@homefinance/shared';

export interface ParsedRow {
  date: string | null; // yyyy-mm-dd
  time: string | null; // HH:mm:ss when available, else null
  description: string;
  amount: number; // negative = expense
  balance: number | null;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[]; // for CSV column-mapping UI
  format: ImportFileFormat;
  /** Closing/ledger balance carried by the file when available (OFX LEDGERBAL).
   *  Null when the file has no explicit statement balance. */
  closingBalance?: number | null;
}

/** Derive the statement's opening balance (balance just before the first
 *  transaction in the file) when possible:
 *  - OFX: closingBalance (LEDGERBAL) − Σ(row amounts).
 *  - CSV: first row carrying a running balance → balance − amount.
 *  Returns null when neither is available (e.g. QIF, or CSV with no balance col). */
export function deriveOpeningBalance(rows: ParsedRow[], closingBalance?: number | null): number | null {
  if (closingBalance != null && Number.isFinite(closingBalance)) {
    const sum = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return round2(closingBalance - sum);
  }
  for (const r of rows) {
    if (r.balance != null && Number.isFinite(r.balance)) {
      return round2(r.balance - (r.amount || 0));
    }
  }
  return null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ---- CSV ----
export function parseCsv(buffer: Buffer, opts?: { hasHeader?: boolean; amountSignConvention?: 'auto' | 'negIsExpense' | 'posIsExpense' }): ParseResult {
  const text = buffer.toString('utf8');
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true, header: false });
  const data = result.data as string[][];
  const hasHeader = opts?.hasHeader ?? true;
  let headers: string[] = [];
  let rowsData = data;
  if (hasHeader && data.length) {
    headers = data[0].map((h, i) => h || `Column ${i + 1}`);
    rowsData = data.slice(1);
  } else {
    headers = (data[0] || []).map((_, i) => `Column ${i + 1}`);
  }
  const rows: ParsedRow[] = rowsData.map((r) => ({
    date: null,
    time: null,
    description: r.join(' '),
    amount: 0,
    balance: null,
    raw: Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])),
  }));
  return { rows, headers, format: 'csv' as const };
}

// Map a parsed CSV row using a column map + sign convention.
export function mapCsvRow(
  raw: Record<string, string>,
  columnMap: Record<string, string | null>,
  sign: 'auto' | 'negIsExpense' | 'posIsExpense',
  dateFormat?: string | null,
): ParsedRow {
  const get = (field: string) => {
    const col = columnMap[field];
    return col ? raw[col] ?? '' : '';
  };
  let amount = parseAmount(get('amount')) ?? 0;
  // debit/credit columns override
  const debit = parseAmount(get('debit'));
  const credit = parseAmount(get('credit'));
  if (debit != null || credit != null) {
    const d = debit ?? 0;
    const c = credit ?? 0;
    amount = c - d; // credit (income) positive, debit (expense) negative
  }
  if (sign === 'negIsExpense' && amount > 0) amount = -amount;
  else if (sign === 'posIsExpense' && amount < 0) amount = -amount;
  // 'auto': assume already signed (negative=expense). If all values positive and
  // no debit/credit cols, caller can flip via sign convention choice.

  return {
    date: parseDate(get('date'), dateFormat),
    time: parseTime(get('time')),
    description: (get('description') || get('reference') || '').trim(),
    amount,
    balance: parseAmount(get('balance')),
    raw,
  };
}

// ---- OFX (SGML or XML) ----
export function parseOfx(buffer: Buffer): ParseResult {
  const text = buffer.toString('utf8').replace(/\r/g, '');
  const rows: ParsedRow[] = [];

  // Statement closing (ledger) balance: <LEDGERBAL><BALAMT>1234.56</BALAMT>...
  let closingBalance: number | null = null;
  const balMatch = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([-\d.,]+)/i);
  if (balMatch) {
    const v = parseAmount(balMatch[1]);
    closingBalance = v ?? null;
  }

  // Normalize SGML: strip < tags into newline-separated fields.
  // Extract <STMTTRN> ... </STMTTRN> blocks (works for both SGML and XML-ish).
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  for (const block of blocks) {
    const g = (tag: string): string | null => {
      const m = block.match(new RegExp(`<${tag}>([^<\\n\\r]*)`, 'i'));
      return m ? m[1].trim() : null;
    };
    const dateRaw = g('DTPOSTED') || g('DTPOSTED');
    const name = g('NAME') || g('MEMO') || '';
    const memo = g('MEMO') || '';
    const trnamt = parseAmount(g('TRNAMT')) ?? 0;
    // OFX DTPOSTED: YYYYMMDDHHMMSS[.sss] — time is the digits after the date.
    const timeRaw = dateRaw && dateRaw.length > 10 ? dateRaw.slice(10).replace(/[^0-9]/g, '').slice(0, 6) : '';
    rows.push({
      date: parseDate(dateRaw),
      time: parseTime(timeRaw),
      description: (name + (memo && memo !== name ? ' ' + memo : '')).trim(),
      amount: trnamt,
      balance: null,
      raw: {
        DTPOSTED: dateRaw || '',
        NAME: name || '',
        MEMO: memo || '',
        TRNAMT: g('TRNAMT') || '',
        FITID: g('FITID') || '',
      },
    });
  }
  return { rows, headers: ['DTPOSTED', 'NAME', 'MEMO', 'TRNAMT', 'FITID'], format: 'ofx' as const, closingBalance };
}

// ---- QIF ----
export function parseQif(buffer: Buffer): ParseResult {
  const text = buffer.toString('utf8').replace(/\r/g, '');
  const lines = text.split('\n');
  const rows: ParsedRow[] = [];
  let cur: Partial<ParsedRow> & { raw?: Record<string, string> } = { raw: {} };
  for (let line of lines) {
    if (!line) continue;
    if (line.startsWith('!')) continue; // type header
    const code = line[0];
    const val = line.slice(1);
    switch (code) {
      case 'D':
        cur.date = parseDate(val);
        cur.raw!.D = val;
        break;
      case 'P':
        cur.description = val;
        cur.raw!.P = val;
        break;
      case 'T':
      case 'U':
        cur.amount = parseAmount(val) ?? 0;
        cur.raw!.T = val;
        break;
      case '^':
        if (cur.date || cur.description) {
          rows.push({
            date: cur.date ?? null,
            time: null,
            description: (cur.description || '').trim(),
            amount: cur.amount ?? 0,
            balance: null,
            raw: cur.raw || {},
          });
        }
        cur = { raw: {} };
        break;
      case 'M':
        cur.raw!.M = val;
        if (!cur.description) cur.description = val;
        break;
      default:
        cur.raw![code] = val;
    }
  }
  return { rows, headers: ['D', 'P', 'T', 'M'], format: 'qif' as const };
}

export function parseFile(buffer: Buffer, format: ImportFileFormat, opts?: { hasHeader?: boolean; amountSignConvention?: 'auto' | 'negIsExpense' | 'posIsExpense' }): ParseResult {
  switch (format) {
    case 'csv':
      return parseCsv(buffer, opts);
    case 'ofx':
      return parseOfx(buffer);
    case 'qif':
      return parseQif(buffer);
    default:
      throw new Error(`unsupported format: ${format}`);
  }
}