import type { Transaction } from '@/lib/types';
import { buildRows, rowIndexForTx } from './row-model';

function tx(id: number, postedOn: string): Transaction {
  return { id, profileId: 1, sourceId: 1, postedOn, description: `T${id}`, merchant: `t${id}`, amountCents: -100, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null };
}

describe('buildRows', () => {
  it('interleaves day headers and keeps flat indices', () => {
    const rows = buildRows([tx(1, '2026-11-14'), tx(2, '2026-11-14'), tx(3, '2026-11-10')]);
    expect(rows.map((r) => r.kind)).toEqual(['header', 'tx', 'tx', 'header', 'tx']);
    const txRows = rows.filter((r) => r.kind === 'tx') as Extract<(typeof rows)[number], { kind: 'tx' }>[];
    expect(txRows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(txRows.map((r) => r.tx.id)).toEqual([1, 2, 3]);
  });

  it('maps a flat tx index back to its row position', () => {
    const rows = buildRows([tx(1, '2026-11-14'), tx(3, '2026-11-10')]);
    expect(rowIndexForTx(rows, 0)).toBe(1); // after first header
    expect(rowIndexForTx(rows, 1)).toBe(3); // after second header
    expect(rowIndexForTx(rows, 9)).toBe(-1);
  });

  it('is empty for no transactions', () => {
    expect(buildRows([])).toEqual([]);
  });

  it('can skip day headers (amount sorts) while keeping flat indices', () => {
    const rows = buildRows([tx(1, '2026-11-14'), tx(3, '2026-11-10'), tx(2, '2026-11-14')], { groupByDay: false });
    expect(rows.map((r) => r.kind)).toEqual(['tx', 'tx', 'tx']);
    expect(rows.map((r) => (r.kind === 'tx' ? r.index : -1))).toEqual([0, 1, 2]);
  });
});

describe('buildRows with month headers (while filtering)', () => {
  const amt = (id: number, postedOn: string, amountCents: number) => ({ ...tx(id, postedOn), amountCents });

  it('adds a month header with the month total above its days', () => {
    const rows = buildRows([amt(1, '2026-11-14', -2000), amt(2, '2026-11-02', -500), amt(3, '2026-10-30', 1000)], { months: true });
    expect(rows.map((r) => r.kind)).toEqual(['month', 'header', 'tx', 'header', 'tx', 'month', 'header', 'tx']);
    const months = rows.filter((r) => r.kind === 'month') as Extract<(typeof rows)[number], { kind: 'month' }>[];
    // Spend counts positive, money in reduces it (Copilot shows what the filter cost you).
    expect(months.map((m) => [m.month, m.totalCents])).toEqual([['2026-11', 2500], ['2026-10', -1000]]);
    const txRows = rows.filter((r) => r.kind === 'tx') as Extract<(typeof rows)[number], { kind: 'tx' }>[];
    expect(txRows.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('adds no month headers when not filtering', () => {
    const rows = buildRows([tx(1, '2026-11-14'), tx(2, '2026-10-02')]);
    expect(rows.some((r) => r.kind === 'month')).toBe(false);
  });
});
