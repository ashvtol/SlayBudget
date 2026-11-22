import { describe, expect, it } from 'vitest';
import type { Recurring } from './types';
import { dueCharges } from './recurring-due';

const bill = (cadence: Recurring['cadence'], nextDate: string): Recurring => ({
  merchant: 'x', categoryId: 1, typicalAmountCents: 1000, cadence, lastDate: '2026-11-01', nextDate, occurrences: 3,
});

describe('dueCharges', () => {
  it('counts every weekly charge still due in the rest of the month', () => {
    // Nov 21 to Nov 30: due Nov 22 and Nov 29.
    expect(dueCharges(bill('weekly', '2026-11-22'), '2026-11-21', '2026-11-30')).toBe(2);
    expect(dueCharges(bill('biweekly', '2026-11-22'), '2026-11-21', '2026-11-30')).toBe(1);
    expect(dueCharges(bill('weekly', '2026-11-08'), '2026-11-01', '2026-11-30')).toBe(4);
  });

  it('counts a monthly bill once, and nothing outside the span', () => {
    expect(dueCharges(bill('monthly', '2026-11-25'), '2026-11-21', '2026-11-30')).toBe(1);
    expect(dueCharges(bill('monthly', '2026-12-02'), '2026-11-21', '2026-11-30')).toBe(0);
    // Next due Nov 10 (missed): Nov 24 is still due in the span.
    expect(dueCharges(bill('weekly', '2026-11-10'), '2026-11-21', '2026-11-30')).toBe(1);
  });
});
