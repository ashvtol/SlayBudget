import type { Transaction } from '@/lib/types';
import { spendBySource } from './use-sidebar-data';

const t = (sourceId: number, amountCents: number, txType: Transaction['txType'], categoryId: number | null = null): Transaction => ({
  id: Math.random(), profileId: 1, sourceId, postedOn: '2026-11-02', description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

describe('spendBySource', () => {
  it('counts Regular spending net of refunds, skipping transfers, income and excluded categories', () => {
    const spend = spendBySource(
      [t(1, -5000, 'regular'), t(1, 1000, 'regular'), t(1, -40000, 'transfer'), t(1, 300000, 'income'), t(1, -700, 'regular', 9), t(2, -200, 'regular')],
      new Set([9]),
    );
    expect(spend.get(1)).toBe(4000);
    expect(spend.get(2)).toBe(200);
  });

  it('never shows negative spend when refunds exceed it', () => {
    expect(spendBySource([t(1, 5000, 'regular')], new Set()).get(1)).toBe(0);
  });
});
