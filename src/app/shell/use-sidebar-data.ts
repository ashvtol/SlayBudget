import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { spendOf } from '@/lib/tx-type';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';

export interface SourceRow {
  source: Source;
  /** Money out this calendar month, as a positive number of cents. */
  monthSpendCents: number;
}

export interface SidebarData {
  toReview: number;
  sources: SourceRow[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Review count and this month's spend per statement source, refreshed when transactions change. */
export function useSidebarData(today: Date = new Date()): SidebarData {
  const profileId = useProfileStore((s) => s.activeProfileId);
  // Any change to the loaded transactions (edits, imports) refreshes the numbers.
  const version = useTransactionsStore((s) => s.transactions);
  const [data, setData] = useState<SidebarData>({ toReview: 0, sources: [] });
  const monthStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [toReview, sources, month, categories] = await Promise.all([
        ipc().countTransactions({ profileId, reviewed: false }),
        ipc().listSources(),
        ipc().listTransactions({ profileId, from: monthStart }),
        ipc().listCategories(),
      ]);
      const spend = spendBySource(month, new Set(categories.filter((c) => c.excluded).map((c) => c.id)));
      const visible = sources.filter((s) => profileId == null || s.profileId === profileId);
      if (!cancelled) setData({ toReview, sources: visible.map((source) => ({ source, monthSpendCents: spend.get(source.id) ?? 0 })) });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [profileId, monthStart, version]);

  return data;
}

/** This month's spending per source, as the Dashboard counts it: Regular rows net of refunds,
 *  leaving out transfers, income and excluded categories; never below zero. */
export function spendBySource(month: Transaction[], excluded: Set<number>): Map<number, number> {
  const spend = new Map<number, number>();
  for (const t of month) {
    if (t.categoryId != null && excluded.has(t.categoryId)) continue;
    spend.set(t.sourceId, (spend.get(t.sourceId) ?? 0) + spendOf(t));
  }
  for (const [k, v] of spend) if (v < 0) spend.set(k, 0);
  return spend;
}

/** Group sources by institution, keeping first-seen order. Sources without one go under "Other". */
export function groupByInstitution(rows: SourceRow[]): { institution: string; rows: SourceRow[] }[] {
  const groups: { institution: string; rows: SourceRow[] }[] = [];
  for (const row of rows) {
    const name = row.source.institution ?? 'Other';
    const group = groups.find((g) => g.institution === name);
    if (group) group.rows.push(row);
    else groups.push({ institution: name, rows: [row] });
  }
  return groups;
}
