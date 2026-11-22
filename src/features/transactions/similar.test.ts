import type { Transaction } from '@/lib/types';
import { monthLabel, similarTransactions } from './similar';

function tx(id: number, postedOn: string, merchant: string, amountCents: number): Transaction {
  return { id, profileId: 1, sourceId: 1, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null };
}

describe('similarTransactions', () => {
  const all = [
    tx(1, '2026-11-14', 'whole foods', -6418),
    tx(2, '2026-11-02', 'whole foods', -3000),
    tx(3, '2026-10-20', 'whole foods', -5000),
    tx(4, '2026-11-10', 'shell oil', -4800),
  ];

  it('groups same-merchant rows by month, excluding the target, newest first', () => {
    const groups = similarTransactions(all, all[0]);
    expect(groups.map((g) => g.month)).toEqual(['2026-11', '2026-10']);
    expect(groups[0].transactions.map((t) => t.id)).toEqual([2]);
    expect(groups[0].totalCents).toBe(-3000);
    expect(groups[1].totalCents).toBe(-5000);
  });

  it('returns nothing when the merchant is unique', () => {
    expect(similarTransactions(all, all[3])).toEqual([]);
  });
});

describe('monthLabel', () => {
  it('formats a YYYY-MM month', () => {
    expect(monthLabel('2026-11')).toBe('November 2026');
  });
});
