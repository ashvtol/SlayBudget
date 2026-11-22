// Pure reminder derivation mirroring crates/core/src/reminders.rs, for the
// memory IPC double. The desktop app uses the Rust version.

import { budgetStatus, detectRecurring } from './analytics';
import type { CategoryMeta, Reminder, Transaction } from './types';

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dueReminders(
  txs: Transaction[],
  categories: CategoryMeta[],
  today: string,
  horizonDays: number,
  children: Map<number, Transaction[]>,
): Reminder[] {
  const out: Reminder[] = [];
  const horizon = addDays(today, horizonDays);

  for (const r of detectRecurring(txs)) {
    if (r.nextDate >= today && r.nextDate <= horizon) {
      out.push({
        kind: 'upcomingBill',
        key: `bill:${r.merchant}:${r.nextDate}`,
        title: `${r.merchant} due soon`,
        body: `About $${(r.typicalAmountCents / 100).toFixed(2)} on ${r.nextDate}`,
        categoryId: r.categoryId,
      });
    }
  }

  const ym = today.slice(0, 7);
  for (const b of budgetStatus(txs, categories, today, children)) {
    if (b.overBudget) {
      out.push({
        kind: 'budgetOver',
        key: `over:${b.categoryId}:${ym}`,
        title: 'Over budget',
        body: `$${((b.spentCents - b.budgetCents) / 100).toFixed(2)} over this month`,
        categoryId: b.categoryId,
      });
    } else if (b.projectedCents > b.budgetCents) {
      out.push({
        kind: 'budgetProjectedOver',
        key: `proj:${b.categoryId}:${ym}`,
        title: 'On pace to overspend',
        body: `Projected $${(b.projectedCents / 100).toFixed(2)} vs $${(b.budgetCents / 100).toFixed(2)} budget`,
        categoryId: b.categoryId,
      });
    }
  }

  return out;
}
