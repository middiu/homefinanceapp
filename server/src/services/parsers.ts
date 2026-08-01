import Papa from 'papaparse';
import { parseAmount, parseDate } from '../utils.js';
import type { ImportFileFormat } from '@homefinance/shared';

export interface ParsedRow {
  date: string | null; // yyyy-mm-dd
  description: string;
  amount: number; // negative = expense
  balance: number | null;
  raw: Record<string, string>;
}

export interface ParseResult {
  rows: ParsedRow[];
  headers: string[]; // for CSV column-mapping UI
  format: ImportFileFormat;
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
    rows.push({
      date: parseDate(dateRaw),
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
  return { rows, headers: ['DTPOSTED', 'NAME', 'MEMO', 'TRNAMT', 'FITID'], format: 'ofx' as const };
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