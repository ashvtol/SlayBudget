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
      { year: 2026, spendCents: 660000, avgChargeCents: 220000, creditedCents: 0 },
      { year: 2025, spendCents: 0, avgChargeCents: 0, creditedCents: 0 },
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

describe('buildRecurrings when the statements stop before today', () => {
  // A new install: the newest statement ends Oct 25, and today is Nov 21.
  const m = buildRecurrings({
    recurring: [
      rec('phone', 4500, '2026-09-30', '2026-10-30'),
      rec('netflix', 1799, '2026-10-20', '2026-11-20'),
      rec('gym', 3000, '2026-08-05', '2026-09-05'),
    ],
    transactions: [
      tx('phone', '2026-08-30', -4500),
      tx('phone', '2026-09-30', -4500),
      tx('netflix', '2026-09-20', -1799),
      tx('netflix', '2026-10-20', -1799),
      tx('gym', '2026-08-05', -3000),
      tx('groceries', '2026-10-25', -2500),
    ],
    today: TODAY,
  });

  it('keeps a bill due after the newest statement in this month, waiting for the next statement, not "not seen lately"', () => {
    expect(m.thisMonth.map((i) => [i.recurring.merchant, i.date, i.paid, i.waiting])).toEqual([
      ['phone', '2026-10-30', false, true],
      ['netflix', '2026-11-20', false, true],
    ]);
    expect(m.summary.leftToPayCents).toBe(4500 + 1799);
  });

  it('still lists a bill whose due date the statements cover as not seen lately', () => {
    expect(m.stale.map((i) => i.recurring.merchant)).toEqual(['gym']);
  });

  it('says where the statements end, so the page can ask for newer ones', () => {
    expect(m.statementsEndOn).toBe('2026-10-25');
    expect(build().statementsEndOn).toBeNull();
  });
});

describe('buildRecurrings stopped bills', () => {
  const stopped = buildRecurrings({
    recurring: [rec('walmart+', 1427, '2025-05-22', '2025-06-22'), rec('adobe', 1102, '2026-03-02', '2026-04-02')],
    transactions: [
      tx('walmart+', '2025-03-22', -1427), tx('walmart+', '2025-04-22', -1427), tx('walmart+', '2025-05-22', -1427),
      tx('adobe', '2026-01-02', -1102), tx('adobe', '2026-03-02', -1102),
      tx('groceries', '2026-11-10', -2500), // the account is still in use: these bills really stopped
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
    saved: { id, status, name: 'Netflix', categoryId: null, matchKind: 'merchant', pattern: 'netflix', minCents: 1500, maxCents: 2200, frequency: 'monthly', dayOfMonth: 28, createdOn: '2026-01-01', alsoMatches: [], paidBackBy: null },
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

describe('buildRecurrings with bills that are paid back', () => {
  const walmart = (paidBackBy: string[] | null): Recurring => ({
    ...rec('walmart+ member', 1428, '2026-10-22', '2026-11-22'),
    saved: {
      id: 9, status: 'active', name: 'Walmart+', categoryId: null, matchKind: 'merchant', pattern: 'walmart+ member', minCents: 900,
      maxCents: 1900, frequency: 'monthly', dayOfMonth: 22, createdOn: '2026-01-01', alsoMatches: [], paidBackBy,
    },
  });
  const charge = (d: string) => ({ ...tx('walmart+ member', d, -1428), recurringId: 9 });
  const credit = (d: string, cents = 1428) => tx('platinum walmart+', d, cents);

  it('pairs each charge with its credit, says how much came back, and leaves it out of left to pay', () => {
    const [sep, oct] = [charge('2026-09-22'), charge('2026-10-22')];
    const [k1, k2] = [credit('2026-09-24'), credit('2026-10-22')];
    const m = buildRecurrings({ recurring: [walmart(['platinum walmart+'])], transactions: [sep, oct, k1, k2], today: TODAY });
    const item = [...m.thisMonth, ...m.future, ...m.stale][0];
    expect(item.credits.get(sep.id)?.id).toBe(k1.id);
    expect(item.credits.get(oct.id)?.id).toBe(k2.id);
    expect(item.credited).toBe('full');
    expect(item.years[0]).toMatchObject({ spendCents: 2856, creditedCents: 2856 });
    expect(m.summary.leftToPayCents).toBe(0);
  });

  it('says partly credited when less came back, and ignores credits a bill is not paid back by', () => {
    const oct = charge('2026-10-22');
    const partly = buildRecurrings({ recurring: [walmart(['platinum walmart+'])], transactions: [oct, credit('2026-10-22', 500)], today: TODAY });
    expect([...partly.thisMonth, ...partly.future][0].credited).toBe('partial');
    expect(partly.summary.leftToPayCents).toBe(1428);
    const none = buildRecurrings({ recurring: [walmart(null)], transactions: [oct, credit('2026-10-22')], today: TODAY });
    const item = [...none.thisMonth, ...none.future][0];
    expect(item.credits.size).toBe(0);
    expect(item.credited).toBeNull();
  });

  it('takes credits off paid so far', () => {
    const nov = charge(`${TODAY.slice(0, 7)}-02`);
    const m = buildRecurrings({ recurring: [walmart(['platinum walmart+'])], transactions: [nov, credit(`${TODAY.slice(0, 7)}-03`)], today: TODAY });
    expect(m.summary.paidCents).toBe(0);
  });
});

describe('buildRecurrings with a credit shared by several bills', () => {
  const bill = (id: number, merchant: string, cents: number, day: number): Recurring => ({
    ...rec(merchant, cents, '2026-09-13', '2026-10-13'),
    saved: {
      id, status: 'active', name: merchant, categoryId: null, matchKind: 'merchant', pattern: merchant, minCents: 0, maxCents: 5000,
      frequency: 'monthly', dayOfMonth: day, createdOn: '2026-01-01', alsoMatches: [], paidBackBy: ['platinum digital'],
    },
  });

  it('counts each credit once, for the nearest charge', () => {
    const youtube = { ...tx('youtube', '2026-09-13', -899), recurringId: 1 };
    const peacock = { ...tx('peacock', '2026-09-09', -1657), recurringId: 2 };
    const credit = tx('platinum digital', '2026-09-13', 899);
    const m = buildRecurrings({ recurring: [bill(1, 'youtube', 899, 13), bill(2, 'peacock', 1657, 9)], transactions: [youtube, peacock, credit], today: TODAY });
    const all = [...m.thisMonth, ...m.future, ...m.stale];
    const of = (id: number) => all.find((i) => i.recurring.saved?.id === id)!;
    expect(of(1).credits.get(youtube.id)?.id).toBe(credit.id);
    expect(of(2).credits.size).toBe(0);
    expect(of(2).credited).toBeNull();
  });
});

describe('buildRecurrings credits by year', () => {
  it('counts each credit in the year of the charge it paid back', () => {
    const bill: Recurring = {
      ...rec('walmart+ member', 1428, '2026-01-22', '2026-02-22'),
      saved: {
        id: 9, status: 'active', name: 'Walmart+', categoryId: null, matchKind: 'merchant', pattern: 'walmart+ member', minCents: 900,
        maxCents: 1900, frequency: 'monthly', dayOfMonth: 22, createdOn: '2025-01-01', alsoMatches: [], paidBackBy: ['platinum walmart+'],
      },
    };
    const dec = { ...tx('walmart+ member', '2025-12-30', -1428), recurringId: 9 };
    const creditInJanuary = tx('platinum walmart+', '2026-01-02', 1428);
    const m = buildRecurrings({ recurring: [bill], transactions: [dec, creditInJanuary], today: TODAY });
    const item = [...m.thisMonth, ...m.future, ...m.stale][0];
    expect(item.years.find((y) => y.year === 2025)).toMatchObject({ spendCents: 1428, creditedCents: 1428 });
    expect(item.years.find((y) => y.year === 2026)).toMatchObject({ spendCents: 0, creditedCents: 0 });
  });
});

describe('buildRecurrings trend', () => {
  const bill = (id: number, merchant: string, cents: number, paidBackBy: string[] | null = null): Recurring => ({
    ...rec(merchant, cents, '2026-11-05', '2026-12-05'),
    saved: {
      id, status: 'active', name: merchant, categoryId: null, matchKind: 'merchant', pattern: merchant, minCents: 0, maxCents: 99999,
      frequency: 'monthly', dayOfMonth: 5, createdOn: '2025-01-01', alsoMatches: [], paidBackBy,
    },
  });
  const charge = (id: number, merchant: string, d: string, cents: number) => ({ ...tx(merchant, d, -cents), recurringId: id });

  it('totals what bills cost each month, after credits, with this month against last month and this year against last', () => {
    const txs = [
      charge(1, 'netflix', '2025-11-05', 1500), charge(1, 'netflix', '2025-12-05', 1500),
      charge(1, 'netflix', '2026-10-05', 1800), charge(1, 'netflix', '2026-11-05', 1800),
      charge(2, 'gym', '2026-10-20', 5000),
      charge(3, 'walmart', '2026-10-22', 1400), tx('platinum walmart', '2026-10-22', 1400),
      charge(4, 'old', '2025-03-01', 900),
    ];
    const recurring = [bill(1, 'netflix', 1800), bill(2, 'gym', 5000), bill(3, 'walmart', 1400, ['platinum walmart'])];
    const archived: Recurring = { ...bill(4, 'old', 900), saved: { ...bill(4, 'old', 900).saved!, status: 'archived' } };
    const t = buildRecurrings({ recurring: [...recurring, archived], transactions: txs, today: TODAY }).trend;
    expect(t.months.map((m) => m.month)).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ]);
    expect(t.months.at(-2)!.paidCents).toBe(6800); // Oct: 1800 + 5000, Walmart credited back in full
    expect(t.months.at(-1)!.paidCents).toBe(1800);
    // Last month up to the same day (Nov 21 -> Oct 21): Netflix and the gym.
    expect(t.lastMonthSoFarCents).toBe(6800);
    expect(t.lastMonthName).toBe('October');
    expect(t.yearToDateCents).toBe(1800 + 6800);
    expect(t.lastYearToDateCents).toBe(900 + 1500); // Mar and Nov 2025, an archived bill included
    expect(t.lastYearCents).toBe(900 + 1500 + 1500);
    expect(t.monthlyAvgCents).toBe(Math.round((1500 + 1500 + 6800) / 12)); // Nov 2025 to Oct 2026
  });
});

describe('buildRecurrings bills not seen yet this month', () => {
  // Today is Nov 21; Hulu is due on the 13th.
  const hulu = rec('hulu', 2763, '2026-10-13', '2026-11-13');
  const history = [tx('hulu', '2026-09-13', -2763), tx('hulu', '2026-10-13', -2763)];
  const itemOf = (more: Transaction[], recs: Recurring[] = [hulu]) =>
    buildRecurrings({ recurring: recs, transactions: [...history, ...more], today: TODAY }).thisMonth.find((i) => i.recurring.merchant === 'hulu')!;

  it('is not seen yet once the statements go past its due day and a few days to post, without it', () => {
    const i = itemOf([tx('groceries', '2026-11-20', -2500)]);
    expect([i.paid, i.waiting, i.late]).toEqual([false, false, true]);
  });

  it('is still waiting within the few days a charge takes to post', () => {
    const i = itemOf([tx('groceries', '2026-11-15', -2500)]);
    expect([i.waiting, i.late]).toEqual([true, false]);
  });

  it('is waiting, not late, when the statements end before its due day', () => {
    const i = itemOf([tx('groceries', '2026-11-10', -2500)]);
    expect([i.waiting, i.late]).toEqual([true, false]);
  });

  it('is never late once paid', () => {
    const i = itemOf([tx('hulu', '2026-11-14', -2763), tx('groceries', '2026-11-20', -2500)]);
    expect([i.paid, i.late]).toEqual([true, false]);
  });

  it('a bill due later this month is not late', () => {
    const later = rec('hulu', 2763, '2026-10-28', '2026-11-28');
    const i = buildRecurrings({ recurring: [later], transactions: [tx('hulu', '2026-10-28', -2763), tx('groceries', '2026-11-20', -2500)], today: TODAY }).thisMonth[0];
    expect(i.late).toBe(false);
  });

  it('only looks at statements from the account that pays it', () => {
    // Another card's statement reaches Nov 20; Hulu's card ends Nov 12.
    const i = itemOf([tx('groceries', '2026-11-12', -2500), tx('gas', '2026-11-20', -4000, 2)]);
    expect([i.waiting, i.late]).toEqual([true, false]);
  });
});
