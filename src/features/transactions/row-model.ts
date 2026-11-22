import { groupByDay } from '@/lib/format';
import type { Transaction } from '@/lib/types';

export type Row =
  | { kind: 'month'; month: string; totalCents: number; key: string }
  | { kind: 'header'; day: string; key: string }
  | { kind: 'tx'; tx: Transaction; index: number; key: string };

/** Flatten a sorted transaction list into header + row items, tagging each row
 *  with its flat index in the original list (for keyboard cursor mapping). */
/** With `months` (while filtering), each month starts with a header carrying its total:
 *  spend counts positive and money in reduces it. */
export function buildRows(transactions: Transaction[], opts: { groupByDay?: boolean; months?: boolean } = {}): Row[] {
  const rows: Row[] = [];
  let index = 0;
  if (opts.groupByDay === false) {
    return transactions.map((tx, i) => ({ kind: 'tx' as const, tx, index: i, key: `t-${tx.id}` }));
  }
  const monthTotals = new Map<string, number>();
  if (opts.months) for (const t of transactions) monthTotals.set(t.postedOn.slice(0, 7), (monthTotals.get(t.postedOn.slice(0, 7)) ?? 0) - t.amountCents);
  let month = '';
  for (const group of groupByDay(transactions)) {
    if (opts.months && group.day.slice(0, 7) !== month) {
      month = group.day.slice(0, 7);
      rows.push({ kind: 'month', month, totalCents: monthTotals.get(month) ?? 0, key: `m-${month}` });
    }
    rows.push({ kind: 'header', day: group.day, key: `h-${group.day}` });
    for (const tx of group.transactions) {
      rows.push({ kind: 'tx', tx, index, key: `t-${tx.id}` });
      index++;
    }
  }
  return rows;
}

/** The row-model position of the transaction at a given flat index, or -1. */
export function rowIndexForTx(rows: Row[], txIndex: number): number {
  return rows.findIndex((r) => r.kind === 'tx' && r.index === txIndex);
}
