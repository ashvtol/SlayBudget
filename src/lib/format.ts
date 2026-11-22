import type { Transaction } from './types';

/** Format integer cents as currency, always positive (callers add any sign). */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Math.abs(cents) / 100);
}

/** Money in gets a leading plus; money out is shown bare. */
export function formatSignedMoney(cents: number, currency: string): string {
  const base = formatMoney(cents, currency);
  return cents > 0 ? `+${base}` : base;
}

export interface DayGroup {
  day: string; // YYYY-MM-DD
  transactions: Transaction[];
}

/** Group an already-sorted (newest first) list into contiguous day runs. */
export function groupByDay(transactions: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.day === t.postedOn) last.transactions.push(t);
    else groups.push({ day: t.postedOn, transactions: [t] });
  }
  return groups;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", or "Mon Nov 10" / "Nov 10, 2025" for older dates. */
export function relativeDayLabel(day: string, today: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const base = `${weekday} ${MONTHS[m - 1]} ${d}`;
  return y === today.getFullYear() ? base : `${MONTHS[m - 1]} ${d}, ${y}`;
}

const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Transaction list day header: "Today", "Yesterday", "Thu, November 19" (year added when not this year). */
export function dayHeaderLabel(day: string, today: Date = new Date()): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
  const base = `${weekday}, ${LONG_MONTHS[m - 1]} ${d}`;
  return y === today.getFullYear() ? base : `${base}, ${y}`;
}

/** "May 9" from "2026-05-09". */
export function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
