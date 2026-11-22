import { describe, expect, it } from 'vitest';
import { dueReminders } from './reminders';
import type { CategoryMeta, Transaction } from './types';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'amountCents' | 'merchant'>): Transaction {
  return { profileId: 1, sourceId: 1, description: over.merchant!, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, ...over };
}

describe('dueReminders', () => {
  it('includes upcoming bills within the horizon only', () => {
    const txs = ['2026-08-20', '2026-09-20', '2026-10-20'].map((d, i) => tx({ id: i + 1, postedOn: d, amountCents: -1599, merchant: 'netflix' }));
    expect(dueReminders(txs, [], '2026-11-15', 3, new Map()).some((r) => r.kind === 'upcomingBill')).toBe(false);
    const wide = dueReminders(txs, [], '2026-11-15', 10, new Map());
    expect(wide.find((r) => r.kind === 'upcomingBill')?.title).toContain('netflix');
  });

  it('flags over-budget and projected overspend', () => {
    const txs = [
      tx({ id: 1, postedOn: '2026-11-03', amountCents: -12000, merchant: 'bar', categoryId: 10 }),
      tx({ id: 2, postedOn: '2026-11-05', amountCents: -40000, merchant: 'store', categoryId: 20 }),
    ];
    const meta: CategoryMeta[] = [
      { id: 10, budgetCents: 10000, excluded: false },
      { id: 20, budgetCents: 60000, excluded: false },
    ];
    const out = dueReminders(txs, meta, '2026-11-15', 5, new Map());
    expect(out.find((r) => r.categoryId === 10)?.kind).toBe('budgetOver');
    expect(out.find((r) => r.categoryId === 20)?.kind).toBe('budgetProjectedOver');
  });
});
