// What something cost over time, for the summaries on Recurrings and Categories: each of the last 12 months, this
// month against last month at the same point, and this year against the same date last year.

export interface SpendTrend {
  /** The last 12 months, ending with this one ("2026-11"). */
  months: { month: string; paidCents: number }[];
  /** Last month up to the same day as today, and its name ("October"). */
  lastMonthSoFarCents: number;
  lastMonthName: string;
  yearToDateCents: number;
  /** Last year up to the same date. */
  lastYearToDateCents: number;
  lastYearCents: number;
  /** The average of the 12 months before this one. */
  monthlyAvgCents: number;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11" moved by whole months. */
export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** The trend of amounts by day ("YYYY-MM-DD", cents) as of `today`. */
export function trendFrom(entries: { day: string; cents: number }[], today: string): SpendTrend {
  const sumWhere = (keep: (day: string) => boolean) => entries.filter((e) => keep(e.day)).reduce((s, e) => s + e.cents, 0);
  const thisMonth = today.slice(0, 7);
  const year = Number(today.slice(0, 4));
  const lastMonth = shiftMonth(thisMonth, -1);
  const dayOfMonth = today.slice(8, 10);
  return {
    months: Array.from({ length: 12 }, (_, i) => {
      const month = shiftMonth(thisMonth, i - 11);
      return { month, paidCents: sumWhere((d) => d.startsWith(month) && d <= today) };
    }),
    lastMonthSoFarCents: sumWhere((d) => d.startsWith(lastMonth) && d.slice(8, 10) <= dayOfMonth),
    lastMonthName: MONTH_NAMES[Number(lastMonth.slice(5, 7)) - 1],
    yearToDateCents: sumWhere((d) => d.startsWith(String(year)) && d <= today),
    lastYearToDateCents: sumWhere((d) => d.startsWith(String(year - 1)) && d.slice(5) <= today.slice(5)),
    lastYearCents: sumWhere((d) => d.startsWith(String(year - 1))),
    monthlyAvgCents: Math.round(sumWhere((d) => d >= `${shiftMonth(thisMonth, -12)}-01` && d < `${thisMonth}-01`) / 12),
  };
}
