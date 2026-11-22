import { useEffect, useState } from 'react';
import { KeptScreen } from './shell/screen';
import type { SectionId } from '@/lib/stores/nav-store';
import { Sidebar } from './shell/sidebar';
import { SettingsDrawer } from '@/features/settings/settings-drawer';
import { TransactionsPage } from '@/features/transactions/transactions-page';
import { ImportPage } from '@/features/import/import-page';
import { DashboardPage } from '@/features/analytics/dashboard-page';
import { CashflowPage } from '@/features/analytics/cashflow-page';
import { CategoriesPage } from '@/features/analytics/categories-page';
import { RecurringPage } from '@/features/analytics/recurring-page';
import { InsightsPage } from '@/features/analytics/insights-page';
import { SearchPalette } from '@/features/search/search-palette';
import { useSearchStore } from '@/features/search/search-store';
import { useNotificationsStore } from '@/features/notifications/notifications-store';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { sectionForShortcut, useNavStore } from '@/lib/stores/nav-store';
import { useThemeStore } from '@/lib/stores/theme-store';
import { useDisplayStore } from '@/lib/stores/display-store';

const SCREENS: [SectionId, (activeProfile: number | null) => React.ReactNode][] = [
  ['dashboard', () => <DashboardPage />],
  ['transactions', () => <TransactionsPage />],
  ['cashflow', () => <CashflowPage />],
  ['categories', () => <CategoriesPage />],
  ['recurring', () => <RecurringPage />],
  ['insights', () => <InsightsPage />],
  ['import', (activeProfile) => <ImportPage onImported={() => void useTransactionsStore.getState().load(activeProfile)} />],
];

export function App() {
  const section = useNavStore((s) => s.section);
  const [visited, setVisited] = useState<SectionId[]>([section]);
  if (!visited.includes(section)) setVisited([...visited, section]);
  const go = useNavStore((s) => s.go);
  const loadTheme = useThemeStore((s) => s.load);
  const loadProfiles = useProfileStore((s) => s.load);
  const activeProfile = useProfileStore((s) => s.activeProfileId);

  useEffect(() => {
    void loadTheme();
    void loadProfiles();
    void useDisplayStore.getState().load();
    // Auto-import any new files in the watched folder, then run reminders.
    void ipc()
      .scanWatchedFolder()
      .catch(() => undefined)
      .then(() => useNotificationsStore.getState().load())
      .then(() => useNotificationsStore.getState().runDueCheck());
  }, [loadTheme, loadProfiles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault();
        useSearchStore.getState().openPalette();
        return;
      }
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const nav = useNavStore.getState();
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        nav.refresh();
        return;
      }
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '[' || (e.key === 'ArrowLeft' && !typing)) {
        e.preventDefault();
        nav.goBack();
        return;
      }
      if (e.key === ']' || (e.key === 'ArrowRight' && !typing)) {
        e.preventDefault();
        nav.goForward();
        return;
      }
      const target = sectionForShortcut(e.key);
      if (target) {
        e.preventDefault();
        go(target);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);


  return (
    <div className="app-root flex h-full overflow-hidden" style={{ color: 'var(--text)' }}>
      <Sidebar />
      {/* Screens stay alive once visited, so switching back keeps scroll, selection and choices. */}
      <div className="relative flex min-w-0 flex-1">
        {SCREENS.filter(([id]) => visited.includes(id)).map(([id, render]) => (
          <KeptScreen key={id} id={id} active={section === id}>
            {render(activeProfile)}
          </KeptScreen>
        ))}
      </div>
      <SettingsDrawer />
      <SearchPalette />
    </div>
  );
}
