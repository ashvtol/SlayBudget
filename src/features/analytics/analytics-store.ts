import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import type {
  BudgetStatus,
  CashFlow,
  Category,
  CategoryGroup,
  CategoryTotal,
  MonthlyTotal,
  Recurring,
  TimeRange,
} from '@/lib/types';

export const RANGE_LABELS: { id: TimeRange; label: string }[] = [
  { id: 'week', label: '1W' },
  { id: 'month', label: '1M' },
  { id: 'threeMonths', label: '3M' },
  { id: 'sixMonths', label: '6M' },
  { id: 'ytd', label: 'YTD' },
  { id: 'year', label: '1Y' },
  { id: 'all', label: 'All' },
];

/** Today as YYYY-MM-DD in local time; overridable in tests. */
export function todayStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AnalyticsState {
  range: TimeRange;
  today: string;
  loading: boolean;
  monthly: MonthlyTotal[];
  categories: CategoryTotal[];
  budgets: BudgetStatus[];
  cashflow: CashFlow | null;
  recurring: Recurring[];
  categoryMeta: Record<number, Category>;
  groups: CategoryGroup[];
  load(profileId: number | null): Promise<void>;
  setRange(range: TimeRange): Promise<void>;
}

const EMPTY_FLOW = { incomeCents: 0, expenseCents: 0, netCents: 0 };

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  range: 'threeMonths',
  today: todayStr(),
  loading: false,
  monthly: [],
  categories: [],
  budgets: [],
  cashflow: { current: EMPTY_FLOW, previous: EMPTY_FLOW, netDeltaCents: 0 },
  recurring: [],
  categoryMeta: {},
  groups: [],

  async load(profileId) {
    // A Mac app stays open for days: every load uses the real date.
    if (get().today !== todayStr()) set({ today: todayStr() });
    const { range, today } = get();
    set({ loading: true });
    const [monthly, categories, budgets, cashflow, recurring, cats, groups] = await Promise.all([
      ipc().analyticsMonthly(profileId, range, today),
      ipc().analyticsCategories(profileId, range, today),
      ipc().analyticsBudgets(profileId, today),
      ipc().analyticsCashflow(profileId, range, today),
      ipc().analyticsRecurring(profileId, today),
      ipc().listCategories(),
      ipc().listCategoryGroups(),
    ]);
    const categoryMeta: Record<number, Category> = {};
    for (const c of cats) categoryMeta[c.id] = c;
    set({ monthly, categories, budgets, cashflow, recurring, categoryMeta, groups, loading: false });
  },

  async setRange(range) {
    set({ range });
  },
}));

/** Keep `today` current while the app stays open: checked every minute and whenever the window comes back to the
 *  front, so this month's screens move to the new month without a restart. Returns a function that stops watching. */
export function watchToday(): () => void {
  const check = () => {
    const now = todayStr();
    if (useAnalyticsStore.getState().today !== now) useAnalyticsStore.setState({ today: now });
  };
  const timer = setInterval(check, 60_000);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  return () => {
    clearInterval(timer);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
