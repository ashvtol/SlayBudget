import type { Recurring } from './types';

const STEP_DAYS: Partial<Record<Recurring['cadence'], number>> = { weekly: 7, biweekly: 14 };

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/**
 * How many charges of a bill fall due from `from` to `to` (inclusive), starting at its next
 * date: a weekly bill can be due several times in the rest of a month, a monthly one once.
 */
export function dueCharges(r: Recurring, from: string, to: string): number {
  const step = STEP_DAYS[r.cadence];
  let n = 0;
  for (let day = r.nextDate; day <= to; day = step ? addDays(day, step) : '9999-12-31') {
    if (day >= from) n++;
    if (!step) break;
  }
  return n;
}
