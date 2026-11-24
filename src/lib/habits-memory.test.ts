import { describe, expect, it } from 'vitest';
import type { Category, Source, SavedRecurring, Transaction } from './types';
import { moneyHabitsFrom } from './habits-memory';

// The same cases as crates/core/tests/habits_test.rs.
const cat = (id: number, name: string, extra: Partial<Category> = {}): Category => ({
  id, groupId: id, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, essential: false, ...extra,
});
const categories = [cat(1, 'Flat Rent', { essential: true }), cat(2, 'Dining Out'), cat(3, 'Paycheck', { kind: 'income' }), cat(4, 'Card Payoff', { excluded: true })];
const sources: Source[] = [
  { id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: null, currency: 'USD' },
  { id: 2, profileId: 1, name: 'Ally Savings', kind: 'csv', institution: null, currency: 'USD', accountType: 'savings' },
];
let nextId = 1;
const tx = (sourceId: number, postedOn: string, amountCents: number, categoryId: number | null, txType: Transaction['txType'], merchant: string, recurringId: number | null = null): Transaction => ({
  id: nextId++, profileId: 1, sourceId, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD', categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType, recurringId,
});
const bill = (id: number, status: SavedRecurring['status'] = 'active') => ({ id, status }) as SavedRecurring;
const run = (transactions: Transaction[], extra: Partial<Parameters<typeof moneyHabitsFrom>[0]> = {}) =>
  moneyHabitsFrom({ transactions, children: new Map(), categories, sources, bills: [], prices: [], today: '2026-11-23', ...extra });

describe('moneyHabitsFrom', () => {
  it('every month from the first, with income, spending, needs and savings', () => {
    const h = run([
      tx(1, '2026-08-03', 500000, 3, 'income', 'payroll'),
      tx(1, '2026-08-01', -200000, 1, 'regular', 'landlord'),
      tx(1, '2026-08-05', -6000, 2, 'regular', 'din tai'),
      tx(1, '2026-08-06', 1000, 2, 'regular', 'din tai'),
      tx(1, '2026-08-07', -40000, 4, 'regular', 'amex'),
      tx(1, '2026-08-08', -50000, null, 'transfer', 'to savings'),
      tx(2, '2026-08-08', 50000, null, 'transfer', 'from checking'),
      tx(1, '2026-10-02', -3000, 2, 'regular', 'din tai'),
    ]);
    expect(h.firstMonth).toBe('2026-08');
    expect(h.currentMonth).toBe('2026-11');
    expect(h.months.map((m) => m.month)).toEqual(['2026-08', '2026-09', '2026-10', '2026-11']);
    expect(h.months[0]).toEqual({ month: '2026-08', incomeCents: 500000, spendCents: 205000, essentialCents: 200000, toSavingsCents: 50000 });
    expect(h.months[1].spendCents).toBe(0);
  });

  it('flexible spending per category and month leaves out needs and bills; bills count as needs', () => {
    const h = run(
      [tx(1, '2026-10-05', -6000, 2, 'regular', 'din tai'), tx(1, '2026-10-09', -1500, 2, 'regular', 'netflix', 7), tx(1, '2026-10-01', -200000, 1, 'regular', 'landlord')],
      { bills: [bill(7)] },
    );
    expect(h.flexible).toEqual([{ categoryId: 2, month: '2026-10', cents: 6000 }]);
    expect(h.months.find((m) => m.month === '2026-10')!.essentialCents).toBe(201500);
  });

  it("this month's days skip bill charges", () => {
    const h = run(
      [tx(1, '2026-11-03', -2500, 2, 'regular', 'din tai'), tx(1, '2026-11-05', -1500, 2, 'regular', 'netflix', 7), tx(1, '2026-10-30', -999, 2, 'regular', 'din tai')],
      { bills: [bill(7)] },
    );
    expect(h.daysThisMonth).toEqual([{ day: '2026-11-03', cents: 2500 }]);
  });

  it('frequent merchants over the last year', () => {
    const rows: Transaction[] = [];
    for (let i = 0; i < 30; i++) rows.push(tx(1, `2026-${String(1 + (i % 10)).padStart(2, '0')}-0${1 + Math.floor(i / 10)}`, -450, 2, 'regular', 'blue bottle'));
    for (let i = 0; i < 10; i++) rows.push(tx(1, `2026-0${1 + (i % 9)}-${15 + Math.floor(i / 9)}`, -9000, 2, 'regular', 'rare treat'));
    rows.push(tx(1, '2025-06-01', -450, 2, 'regular', 'blue bottle'));
    expect(run(rows).merchants).toEqual([{ name: 'blue bottle', visits: 30, totalCents: 13500 }]);
  });

  it('bills that went up in the last year', () => {
    const prices = [
      { recurringId: 7, changedOn: '2026-03-01', fromCents: 1500, toCents: 1800 },
      { recurringId: 7, changedOn: '2026-06-01', fromCents: 1800, toCents: 1700 },
      { recurringId: 7, changedOn: '2025-01-01', fromCents: 1200, toCents: 1500 },
    ];
    expect(run([], { prices }).billsRaisedLast12).toBe(1);
  });

  it('no history gives no months', () => {
    const h = run([]);
    expect(h.firstMonth).toBeNull();
    expect(h.months).toEqual([]);
  });
});

describe('the memory IPC', () => {
  it('answers moneyHabits from its rows', async () => {
    const { createMemoryIpc } = await import('./ipc');
    const ipc = createMemoryIpc({ transactions: [tx(1, '2026-10-02', -3000, null, 'regular', 'din tai')] });
    const h = await ipc.moneyHabits(null, '2026-11-23');
    expect(h.months.map((m) => [m.month, m.spendCents])).toEqual([['2026-10', 3000], ['2026-11', 0]]);
  });
});
