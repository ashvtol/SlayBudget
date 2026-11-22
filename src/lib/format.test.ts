import { formatMoney, formatSignedMoney, groupByDay, relativeDayLabel, dayHeaderLabel } from './format';
import type { Transaction } from './types';

function tx(id: number, postedOn: string): Transaction {
  return { id, profileId: 1, sourceId: 1, postedOn, description: `T${id}`, merchant: `t${id}`, amountCents: -100, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null };
}

describe('formatMoney', () => {
  it('formats cents as currency without a sign', () => {
    expect(formatMoney(-6418, 'USD')).toBe('$64.18');
    expect(formatMoney(325000, 'USD')).toBe('$3,250.00');
    expect(formatMoney(0, 'USD')).toBe('$0.00');
  });
  it('honours other currencies', () => {
    expect(formatMoney(-500, 'EUR')).toContain('5.00');
  });
});

describe('formatSignedMoney', () => {
  it('shows money in with a plus and money out bare', () => {
    expect(formatSignedMoney(-6418, 'USD')).toBe('$64.18');
    expect(formatSignedMoney(325000, 'USD')).toBe('+$3,250.00');
  });
});

describe('groupByDay', () => {
  it('groups newest day first, keeping input order within a day', () => {
    const rows = [tx(1, '2026-11-14'), tx(2, '2026-11-14'), tx(3, '2026-11-10')];
    const groups = groupByDay(rows);
    expect(groups.map((g) => g.day)).toEqual(['2026-11-14', '2026-11-10']);
    expect(groups[0].transactions.map((t) => t.id)).toEqual([1, 2]);
  });
  it('returns nothing for an empty list', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('relativeDayLabel', () => {
  const today = new Date('2026-11-16T12:00:00');
  it('labels today and yesterday, then a full date', () => {
    expect(relativeDayLabel('2026-11-16', today)).toBe('Today');
    expect(relativeDayLabel('2026-11-15', today)).toBe('Yesterday');
    expect(relativeDayLabel('2026-11-10', today)).toMatch(/Nov 10/);
  });
});

describe('dayHeaderLabel', () => {
  const today = new Date(2026, 10, 21); // Sat Nov 21, 2026
  it('says Today and Yesterday', () => {
    expect(dayHeaderLabel('2026-11-21', today)).toBe('Today');
    expect(dayHeaderLabel('2026-11-20', today)).toBe('Yesterday');
  });
  it('spells out weekday and month for other days this year', () => {
    expect(dayHeaderLabel('2026-11-19', today)).toBe('Thu, November 19');
  });
  it('adds the year for earlier years', () => {
    expect(dayHeaderLabel('2025-12-31', today)).toBe('Wed, December 31, 2025');
  });
});

describe('shortDate', () => {
  it('formats a day as month and day', async () => {
    const { shortDate } = await import('./format');
    expect(shortDate('2026-05-09')).toBe('May 9');
  });
});
