import { describe, expect, it } from 'vitest';
import type { Recurring, Transaction } from '@/lib/types';
import { buildRecurrings, ordinalDay } from './recurrings-model';

let nextId = 1;
const tx = (merchant: string, postedOn: string, amountCents: number, sourceId = 1): Transaction => ({
  id: nextId++, profileId: 1, sourceId, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const rec = (merchant: string, typicalAmountCents: number, lastDate: string, nextDate: string, cadence: Recurring['cadence'] = 'monthly'): Recurring => ({
  merchant, categoryId: null, typicalAmountCents, cadence, lastDate, nextDate, occurrences: 3,
});

const TODAY = '2026-11-21';
const transactions = [
  tx('rent', '2026-09-01', -220000, 3),
  tx('rent', '2026-10-01', -220000, 3),
  tx('rent', '2026-11-01', -220000, 3),
  tx('netflix', '2026-09-28', -1799),
  tx('netflix', '2026-10-28', -1799),
  tx('domain', '2025-01-05', -1500),
  tx('domain', '2026-01-05', -1500),
  tx('rent', '2026-11-02', 5000, 3), // a refund: not a charge
];
const recurring = [
  rec('rent', 220000, '2026-11-01', '2026-12-01'),
  rec('netflix', 1799, '2026-10-28', '2026-11-28'),
  rec('domain', 1500, '2026-01-05', '2027-01-05', 'yearly'),
];
const build = () => buildRecurrings({ recurring, transactions, today: TODAY });

describe('ordinalDay', () => {
  it('formats a date as "Nov 1st"', () => {
    expect(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-11', '2026-11-22'].map(ordinalDay)).toEqual([
      'Nov 1st', 'Nov 2nd', 'Nov 3rd', 'Nov 4th', 'Nov 11th', 'Nov 22nd',
    ]);
  });
});

describe('buildRecurrings lists', () => {
  const m = build();

  it('this month holds bills paid this month and bills still due this month, by day', () => {
    expect(m.thisMonth.map((i) => [i.recurring.merchant, i.date, i.paid])).toEqual([
      ['rent', '2026-11-01', true],
      ['netflix', '2026-11-28', false],
    ]);
  });

  it('the future holds bills next due after this month', () => {
    expect(m.future.map((i) => [i.recurring.merchant, i.date])).toEqual([['domain', '2027-01-05']]);
  });

  it('sums what is left to pay and what was paid this month', () => {
    expect(m.summary).toEqual({ leftToPayCents: 1799, paidCents: 220000 });
  });
});

describe('buildRecurrings detail', () => {
  const rent = build().thisMonth[0];

  it('lists past charges newest first, without refunds', () => {
    expect(rent.charges.map((t) => t.postedOn)).toEqual(['2026-11-01', '2026-10-01', '2026-09-01']);
  });

  it('describes the matching rules', () => {
    expect(rent.rules).toEqual({ name: 'Rent', minCents: 183333, maxCents: 264000, cadence: 'every month', day: null });
  });

  it('marks each month of this year: paid, missed after it started, upcoming from now, or before it started', () => {
    expect(rent.timeline.map((t) => t.state)).toEqual([
      'none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'paid', 'paid', 'paid', 'upcoming',
    ]);
    const netflix = build().thisMonth[1];
    expect(netflix.timeline.slice(8).map((t) => t.state)).toEqual(['paid', 'paid', 'upcoming', 'upcoming']);
  });

  it('a yearly bill marks only the month it was paid, with nothing upcoming this year', () => {
    const domain = build().future[0];
    expect(domain.timeline.map((t) => t.state)).toEqual(['paid', ...new Array(11).fill('none')]);
  });

  it('reports yearly spend, average charge and the account last used', () => {
    expect(rent.years).toEqual([
      { year: 2026, spendCents: 660000, avgChargeCents: 220000 },
      { year: 2025, spendCents: 0, avgChargeCents: 0 },
    ]);
    expect(rent.lastSourceId).toBe(3);
  });
});

describe('buildRecurrings missed months', () => {
  it('marks a month with no charge after the bill started as missed', () => {
    const m = buildRecurrings({
      recurring: [rec('gym', 5500, '2026-10-05', '2026-11-05')],
      transactions: [tx('gym', '2026-08-05', -5500), tx('gym', '2026-10-05', -5500)],
      today: TODAY,
    });
    const gym = m.thisMonth[0];
    expect(gym.timeline.slice(7).map((t) => t.state)).toEqual(['paid', 'missed', 'paid', 'upcoming', 'upcoming']);
    expect(gym.paid).toBe(false); // due Nov 5, not paid yet: still counts as left to pay
    expect(m.summary.leftToPayCents).toBe(5500);
  });
});

describe('buildRecurrings excluded categories', () => {
  it('leaves out bills in excluded categories (card payments, transfers)', () => {
    const m = buildRecurrings({
      recurring: [{ ...rec('amex payment', 185000, '2026-11-20', '2026-12-20'), categoryId: 99 }, rec('rent', 220000, '2026-11-01', '2026-12-01')],
      transactions: [{ ...tx('amex payment', '2026-11-20', -185000), categoryId: 99 }, tx('rent', '2026-11-01', -220000)],
      today: TODAY,
      excludedCategoryIds: new Set([99]),
    });
    expect(m.thisMonth.map((i) => i.recurring.merchant)).toEqual(['rent']);
    expect(m.summary.paidCents).toBe(220000);
  });
});

describe('buildRecurrings bills not seen lately', () => {
  it('lists bills expected before this month but never charged separately, out of left to pay', () => {
    const m = buildRecurrings({
      recurring: [rec('geico auto', 14200, '2026-06-03', '2026-07-03'), rec('rent', 220000, '2026-11-01', '2026-12-01')],
      transactions: [tx('geico auto', '2026-06-03', -14200), tx('rent', '2026-11-01', -220000)],
      today: TODAY,
    });
    expect(m.stale.map((i) => [i.recurring.merchant, i.date])).toEqual([['geico auto', '2026-07-03']]);
    expect(m.thisMonth.map((i) => i.recurring.merchant)).toEqual(['rent']);
    expect(m.future).toEqual([]);
    expect(m.summary.leftToPayCents).toBe(0);
  });
});

describe('buildRecurrings stopped bills', () => {
  const stopped = buildRecurrings({
    recurring: [rec('walmart+', 1427, '2025-05-22', '2025-06-22'), rec('adobe', 1102, '2026-03-02', '2026-04-02')],
    transactions: [
      tx('walmart+', '2025-03-22', -1427), tx('walmart+', '2025-04-22', -1427), tx('walmart+', '2025-05-22', -1427),
      tx('adobe', '2026-01-02', -1102), tx('adobe', '2026-03-02', -1102),
    ],
    today: TODAY,
  });

  it('shows no missed or upcoming months after a stopped bill last charged', () => {
    const walmart = stopped.stale.find((i) => i.recurring.merchant === 'walmart+')!;
    expect(walmart.timeline.every((t) => t.state === 'none')).toBe(true); // nothing in 2026
  });

  it('marks gaps between the first and last charge as missed, and nothing after the last', () => {
    const adobe = stopped.stale.find((i) => i.recurring.merchant === 'adobe')!;
    expect(adobe.timeline.slice(0, 5).map((t) => t.state)).toEqual(['paid', 'missed', 'paid', 'none', 'none']);
    expect(adobe.timeline.slice(5).every((t) => t.state === 'none')).toBe(true);
  });

  it('lists the most recently seen stopped bill first', () => {
    expect(stopped.stale.map((i) => i.recurring.merchant)).toEqual(['adobe', 'walmart+']);
  });
});

describe('buildRecurrings with saved bills', () => {
  const saved = (id: number, status: 'active' | 'paused' | 'archived', over: Partial<Recurring> = {}): Recurring => ({
    ...rec('netflix', 1799, '2026-10-28', '2026-11-28'),
    saved: { id, status, name: 'Netflix', categoryId: null, matchKind: 'merchant', pattern: 'netflix', minCents: 1500, maxCents: 2200, frequency: 'monthly', dayOfMonth: 28, createdOn: '2026-01-01' },
    ...over,
  });

  it('takes charges from the link, not the merchant name', () => {
    const linked = { ...tx('netflix', '2026-10-28', -1799), recurringId: 7 };
    const other = tx('netflix', '2026-09-28', -1799);
    const m = buildRecurrings({ recurring: [saved(7, 'active')], transactions: [linked, other], today: TODAY });
    expect(m.thisMonth[0].charges.map((t) => t.id)).toEqual([linked.id]);
  });

  it('shows the saved rules', () => {
    const m = buildRecurrings({ recurring: [saved(7, 'active')], transactions: [], today: TODAY });
    expect(m.thisMonth[0].rules).toMatchObject({ name: 'Netflix', minCents: 1500, maxCents: 2200, cadence: 'every month', day: 28 });
  });

  it('lists paused and archived bills on their own, outside the totals', () => {
    const m = buildRecurrings({ recurring: [saved(1, 'active'), saved(2, 'paused'), saved(3, 'archived')], transactions: [], today: TODAY });
    expect(m.thisMonth.map((i) => i.key)).toEqual(['1']);
    expect(m.paused.map((i) => i.key)).toEqual(['2']);
    expect(m.archived.map((i) => i.key)).toEqual(['3']);
    expect(m.summary.leftToPayCents).toBe(1799);
  });
});
