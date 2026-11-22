// Everything the Copilot-style Recurrings screen shows: this month vs future
// bills, what is left to pay, and per-bill rules, timeline and history.

import type { Recurring, Transaction } from '@/lib/types';
import { cleanMerchant } from '@/lib/merchant';

export type MonthState = 'paid' | 'missed' | 'upcoming' | 'none';

export interface RecurringItem {
  /** Stable key: the saved bill's id, or the merchant for a detected one. */
  key: string;
  recurring: Recurring;
  /** The charge date this month (paid or expected), or the next date for future bills. */
  date: string;
  paid: boolean;
  charges: Transaction[];
  rules: { name: string; minCents: number; maxCents: number; cadence: string; day: number | null };
  timeline: { month: string; state: MonthState }[];
  years: { year: number; spendCents: number; avgChargeCents: number }[];
  lastSourceId: number | null;
}

export interface RecurringsModel {
  summary: { leftToPayCents: number; paidCents: number };
  thisMonth: RecurringItem[];
  future: RecurringItem[];
  /** Expected before this month but never charged: stopped, or the data ends early. */
  stale: RecurringItem[];
  paused: RecurringItem[];
  archived: RecurringItem[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CADENCE: Record<Recurring['cadence'], string> = {
  weekly: 'every week',
  biweekly: 'every 2 weeks',
  monthly: 'every month',
  quarterly: 'every quarter',
  yearly: 'every year',
};
const pad = (n: number) => String(n).padStart(2, '0');

/** A bill's display name: the user's name, or (for automatically named bills, whose name is
 *  just the merchant key) the cleaned merchant ("wsdot goodtogo" shows as "Good To Go"). */
export function displayName(r: Recurring): string {
  const s = r.saved;
  if (!s) return cleanMerchant(r.merchant);
  return s.name.trim().toLowerCase() === s.pattern.trim().toLowerCase() ? cleanMerchant(r.merchant) : s.name;
}

/** "Nov 1st", "Nov 22nd". */
export function ordinalDay(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  const teen = d % 100 >= 11 && d % 100 <= 13;
  const suffix = teen ? 'th' : d % 10 === 1 ? 'st' : d % 10 === 2 ? 'nd' : d % 10 === 3 ? 'rd' : 'th';
  return `${MONTHS[m - 1]} ${d}${suffix}`;
}

export function buildRecurrings(input: {
  recurring: Recurring[];
  transactions: Transaction[];
  today: string;
  /** Categories excluded from totals (card payments, transfers): not bills. */
  excludedCategoryIds?: Set<number>;
}): RecurringsModel {
  const { transactions, today } = input;
  const excluded = input.excludedCategoryIds ?? new Set<number>();
  const recurring = input.recurring.filter((r) => r.categoryId == null || !excluded.has(r.categoryId));
  const [y, m] = today.split('-').map(Number);
  const thisMonthKey = `${y}-${pad(m)}`;
  const frequent = (r: Recurring) => r.cadence === 'weekly' || r.cadence === 'biweekly' || r.cadence === 'monthly';

  const allItems: RecurringItem[] = recurring.map((r) => {
    const charges = transactions
      .filter((t) => (r.saved ? t.recurringId === r.saved.id : t.merchant === r.merchant) && t.amountCents < 0 && t.postedOn <= today)
      .sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.id - a.id);
    const paidThisMonth = charges.find((t) => t.postedOn.startsWith(thisMonthKey));
    const months = new Set(charges.map((t) => t.postedOn.slice(0, 7)));
    const firstMonth = charges.length ? charges[charges.length - 1].postedOn.slice(0, 7) : null;
    const lastMonth = charges.length ? charges[0].postedOn.slice(0, 7) : null;
    // Stopped: expected before this month and never charged since.
    const stopped = !paidThisMonth && r.nextDate < `${thisMonthKey}-01`;

    const timeline = Array.from({ length: 12 }, (_, i) => {
      const month = `${y}-${pad(i + 1)}`;
      let state: MonthState = 'none';
      if (months.has(month)) state = 'paid';
      else if (stopped) {
        // Only gaps inside the span it was active count as missed.
        if (frequent(r) && firstMonth != null && lastMonth != null && month > firstMonth && month < lastMonth) state = 'missed';
      } else if (frequent(r) && month >= thisMonthKey) state = 'upcoming';
      else if (!frequent(r) && r.nextDate.startsWith(month)) state = 'upcoming';
      else if (frequent(r) && firstMonth != null && month > firstMonth) state = 'missed';
      return { month, state };
    });

    const years = [y, y - 1].map((year) => {
      const inYear = charges.filter((t) => t.postedOn.startsWith(String(year)));
      const spendCents = inYear.reduce((s, t) => s - t.amountCents, 0);
      return { year, spendCents, avgChargeCents: inYear.length ? Math.round(spendCents / inYear.length) : 0 };
    });

    return {
      key: r.saved ? String(r.saved.id) : r.merchant,
      recurring: r,
      date: paidThisMonth?.postedOn ?? r.nextDate,
      paid: paidThisMonth != null,
      charges,
      rules: r.saved
        ? { name: displayName(r), minCents: r.saved.minCents, maxCents: r.saved.maxCents, cadence: CADENCE[r.saved.frequency], day: r.saved.dayOfMonth }
        : {
            name: cleanMerchant(r.merchant),
            minCents: Math.round(r.typicalAmountCents / 1.2),
            maxCents: Math.round(r.typicalAmountCents * 1.2),
            cadence: CADENCE[r.cadence],
            day: null,
          },
      timeline,
      years,
      lastSourceId: charges[0]?.sourceId ?? null,
    };
  });

  const byDate = (a: RecurringItem, b: RecurringItem) => a.date.localeCompare(b.date) || a.recurring.merchant.localeCompare(b.recurring.merchant);
  const statusOf = (i: RecurringItem) => i.recurring.saved?.status ?? 'active';
  const paused = allItems.filter((i) => statusOf(i) === 'paused').sort(byDate);
  const archived = allItems.filter((i) => statusOf(i) === 'archived').sort((a, b) => a.rules.name.localeCompare(b.rules.name));
  const items = allItems.filter((i) => statusOf(i) === 'active');
  const thisMonth = items.filter((i) => i.paid || i.date.startsWith(thisMonthKey)).sort(byDate);
  const stale = items
    .filter((i) => !thisMonth.includes(i) && i.date < `${thisMonthKey}-01`)
    .sort((a, b) => b.recurring.lastDate.localeCompare(a.recurring.lastDate) || a.recurring.merchant.localeCompare(b.recurring.merchant));
  const future = items.filter((i) => !thisMonth.includes(i) && !stale.includes(i)).sort(byDate);

  return {
    summary: {
      leftToPayCents: thisMonth.filter((i) => !i.paid).reduce((s, i) => s + i.recurring.typicalAmountCents, 0),
      paidCents: thisMonth.filter((i) => i.paid).reduce((s, i) => s - (i.charges[0]?.amountCents ?? 0), 0),
    },
    thisMonth,
    future,
    stale,
    paused,
    archived,
  };
}
