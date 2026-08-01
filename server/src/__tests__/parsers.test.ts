import { describe, it, expect } from 'vitest';
import { parseCsv, parseOfx, parseQif, mapCsvRow, deriveOpeningBalance } from '../services/parsers.js';

describe('parseCsv', () => {
  it('parses header + rows and exposes headers', () => {
    const buf = Buffer.from('Date,Description,Amount,Balance\n01/07/2026,Coffee,-4.50,95.50\n');
    const r = parseCsv(buf);
    expect(r.format).toBe('csv');
    expect(r.headers).toEqual(['Date', 'Description', 'Amount', 'Balance']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].raw).toHaveProperty('Date', '01/07/2026');
  });
  it('handles no-header files', () => {
    const buf = Buffer.from('01/07/2026,Coffee,-4.50\n');
    const r = parseCsv(buf, { hasHeader: false });
    expect(r.rows).toHaveLength(1);
  });
});

describe('mapCsvRow', () => {
  const map = { date: 'Date', description: 'Description', amount: 'Amount', balance: 'Balance' };
  it('maps columns and parses date + amount + balance', () => {
    const row = mapCsvRow({ Date: '01/07/2026', Description: 'Coffee', Amount: '-4.50', Balance: '95.50' }, map, 'auto');
    expect(row.date).toBe('2026-07-01');
    expect(row.amount).toBe(-4.5);
    expect(row.balance).toBe(95.5);
    expect(row.description).toBe('Coffee');
  });
  it('combines debit/credit columns into a signed amount', () => {
    const m = { date: 'Date', description: 'Desc', debit: 'Debit', credit: 'Credit' };
    const row = mapCsvRow({ Date: '02/07/2026', Desc: 'Pay', Debit: '100', Credit: '0' }, m, 'auto');
    expect(row.amount).toBe(-100); // credit(0) - debit(100)
  });
  it('flips sign with negIsExpense convention', () => {
    const row = mapCsvRow({ Date: '03/07/2026', Description: 'X', Amount: '50' }, map, 'negIsExpense');
    expect(row.amount).toBe(-50);
  });
});

describe('parseOfx', () => {
  it('extracts STMTTRN blocks', () => {
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260701<TRNAMT>-85.20<NAME>WOOLWORTHS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260703<TRNAMT>5000.00<NAME>SALARY</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseOfx(Buffer.from(ofx));
    expect(r.format).toBe('ofx');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].date).toBe('2026-07-01');
    expect(r.rows[0].amount).toBe(-85.2);
    expect(r.rows[0].description).toContain('WOOLWORTHS');
    expect(r.rows[1].amount).toBe(5000);
  });
  it('parses LEDGERBAL closing balance and derives opening balance', () => {
    const ofx = `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<LEDGERBAL><BALAMT>4914.80<DTASOF>20260703</LEDGERBAL>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260701<TRNAMT>-85.20<NAME>WOOLWORTHS</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260703<TRNAMT>5000.00<NAME>SALARY</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const r = parseOfx(Buffer.from(ofx));
    expect(r.closingBalance).toBe(4914.8);
    // opening = closing - Σ(amounts) = 4914.8 - (-85.2 + 5000) = 0
    expect(deriveOpeningBalance(r.rows, r.closingBalance)).toBe(0);
  });
});

describe('deriveOpeningBalance', () => {
  it('uses first running-balance row (balance - amount) when no closing balance', () => {
    const rows = [
      { date: '2026-07-01', time: null, description: 'X', amount: -85.2, balance: 914.8, raw: {} },
      { date: '2026-07-02', time: null, description: 'Y', amount: -10, balance: 904.8, raw: {} },
    ];
    expect(deriveOpeningBalance(rows, null)).toBe(1000); // 914.8 - (-85.2)
  });
  it('returns null when no balance info available', () => {
    const rows = [{ date: '2026-07-01', time: null, description: 'X', amount: -10, balance: null, raw: {} }];
    expect(deriveOpeningBalance(rows, null)).toBeNull();
  });
});

describe('parseQif', () => {
  it('parses D/P/T/^(end-of-record) records', () => {
    const qif = `!Type:Bank
D01/07/2026
PCoffee
T-4.50
^
D02/07/2026
PSalary
T5000.00
^
`;
    const r = parseQif(Buffer.from(qif));
    expect(r.format).toBe('qif');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].date).toBe('2026-07-01');
    expect(r.rows[0].description).toBe('Coffee');
    expect(r.rows[0].amount).toBe(-4.5);
    expect(r.rows[1].amount).toBe(5000);
  });
});