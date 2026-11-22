import type { Transaction } from '@/lib/types';

export interface MonthGroup {
  month: string; // YYYY-MM
  label: string; // e.g. "November 2026"
  totalCents: number;
  transactions: Transaction[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Other transactions with the same merchant, grouped by month, newest month first. */
export function similarTransactions(all: Transaction[], target: Transaction): MonthGroup[] {
  const matches = all
    .filter((t) => t.id !== target.id && t.merchant === target.merchant)
    .sort((a, b) => (a.postedOn < b.postedOn ? 1 : a.postedOn > b.postedOn ? -1 : b.id - a.id));
  const groups: MonthGroup[] = [];
  for (const t of matches) {
    const month = t.postedOn.slice(0, 7);
    let group = groups.find((g) => g.month === month);
    if (!group) {
      group = { month, label: monthLabel(month), totalCents: 0, transactions: [] };
      groups.push(group);
    }
    group.transactions.push(t);
    group.totalCents += t.amountCents;
  }
  return groups;
}
