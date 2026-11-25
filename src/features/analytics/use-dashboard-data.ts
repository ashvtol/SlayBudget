import { useScreen } from '@/app/shell/screen';
import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { withGroupColors } from '@/lib/category-colors';
import type { Category, CategoryGroup, Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';
import { buildDashboard, type DashboardModel } from './dashboard-model';

export interface DashboardData {
  model: DashboardModel;
  toReview: Transaction[];
  /** Transactions in Other (or uncategorized), across all profiles. */
  otherCount: number;
  /** Transactions with a suggested category to check. */
  suggestedCount: number;
  categoriesById: Record<number, Category>;
  groupsById: Record<number, CategoryGroup>;
  sourcesById: Record<number, Source>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Loads last month and this month for the active profile and builds the dashboard model. */
export function useDashboardData(): DashboardData | null {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let live = true;
    const [y, m] = today.split('-').map(Number);
    const prevStart = m === 1 ? `${y - 1}-12-01` : `${y}-${pad(m - 1)}-01`;
    void (async () => {
      const [transactions, categories, groups, recurring, toReview, sources, other, plan, suggestedCount] = await Promise.all([
        ipc().listTransactions({ profileId, from: prevStart, to: today }),
        ipc().listCategories(),
        ipc().listCategoryGroups(),
        ipc().analyticsRecurring(profileId, today),
        ipc().listTransactions({ profileId, reviewed: false, limit: 6 }),
        ipc().listSources(),
        ipc().otherGroups(),
        ipc().getBudgetPlan(),
        ipc().suggestionCount(profileId),
      ]);
      if (!live) return;
      setData({
        model: buildDashboard({ transactions, categories, groups, recurring, today, plan }),
        toReview,
        otherCount: other.reduce((n, g) => n + g.count, 0),
        suggestedCount,
        categoriesById: Object.fromEntries(withGroupColors(categories, groups).map((c) => [c.id, c])),
        groupsById: Object.fromEntries(groups.map((g) => [g.id, g])),
        sourcesById: Object.fromEntries(sources.map((s) => [s.id, s])),
      });
    })();
    return () => {
      live = false;
    };
  }, [profileId, today, activation]);

  return data;
}
