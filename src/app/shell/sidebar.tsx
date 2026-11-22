import { useState, type ComponentType } from 'react';
import { SOURCE_DOTS } from '@/lib/source-colors';
import { SECTIONS, useNavStore, type SectionId } from '@/lib/stores/nav-store';
import { useSearchStore } from '@/features/search/search-store';
import { Money } from '@/components/money';
import {
  IconChevronLeft,
  IconChevronRight,
  IconRefresh,
  IconCashflow,
  IconCategories,
  IconDashboard,
  IconImport,
  IconInsights,
  IconRecurring,
  IconSearch,
  IconSettings,
  IconTransactions,
  IconTriangleDown,
  IconTriangleRight,
} from '@/components/icons';
import { Logo } from './logo';
import { ProfileSwitcher } from './profile-switcher';
import { UpdateBadge } from '@/features/updates/update-ui';
import { groupByInstitution, useSidebarData } from './use-sidebar-data';

const ICONS: Record<SectionId, ComponentType<{ size?: number }>> = {
  dashboard: IconDashboard,
  transactions: IconTransactions,
  cashflow: IconCashflow,
  categories: IconCategories,
  recurring: IconRecurring,
  insights: IconInsights,
  import: IconImport,
  settings: IconSettings,
};

const DOTS = SOURCE_DOTS;

export function Sidebar() {
  const section = useNavStore((s) => s.section);
  const settingsOpen = useNavStore((s) => s.settingsOpen);
  const go = useNavStore((s) => s.go);
  const openPalette = useSearchStore((s) => s.openPalette);
  const { toReview, sources } = useSidebarData();
  const main = SECTIONS.filter((s) => s.id !== 'settings');
  const groups = groupByInstitution(sources);
  let dot = 0;

  return (
    <nav aria-label="Sections" className="sidebar flex h-full w-[256px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--line)' }}>
      {/* Same height as the header bars; the macOS traffic lights sit on its left. */}
      <div data-testid="titlebar" data-tauri-drag-region className="flex h-[45px] shrink-0 items-center pl-[84px] pr-3">
        <Logo />
        <HistoryButtons />
      </div>
      <div className="px-3">
        <button
          type="button"
          onClick={openPalette}
          className="flex h-[24px] w-full items-center justify-center gap-1.5 rounded-md border text-[12px]"
          style={{ borderColor: 'var(--line-strong)', background: 'var(--bg)', color: 'var(--muted)' }}
        >
          <IconSearch size={12} />
          Search
        </button>
      </div>

      <ul className="m-0 mt-5 flex list-none flex-col gap-0.5 p-0 px-3">
        {main.map((s) => (
          <li key={s.id}>
            <NavLink id={s.id} label={s.label} shortcut={s.shortcut} active={section === s.id} onSelect={go} badge={s.id === 'transactions' && toReview > 0 ? toReview : undefined} />
          </li>
        ))}
      </ul>

      {groups.length > 0 && (
        <div className="mt-7 min-h-0 flex-1 overflow-y-auto px-3" aria-label="Statement sources" role="group">
          <div className="label-caps mb-2 px-2.5" style={{ color: 'var(--muted)', fontSize: 10 }}>
            My sources <span className="normal-case tracking-normal opacity-70">· spent this month</span>
          </div>
          {groups.map((g) => (
            <SourceGroup key={g.institution} name={g.institution}>
              {g.rows.map((r) => (
                <li key={r.source.id} className="flex h-[21px] items-center gap-2.5 px-2.5 text-[12px]">
                  <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: DOTS[dot++ % DOTS.length] }} />
                  <span className="min-w-0 flex-1 truncate">{r.source.name}</span>
                  <Money cents={r.monthSpendCents} decimals={false} tone="muted" className="text-[11px]" />
                </li>
              ))}
            </SourceGroup>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 px-3 pb-4 pt-3">
        <ProfileSwitcher />
        <UpdateBadge />
        <a
          href="#settings"
          aria-current={settingsOpen ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            go('settings');
          }}
          className="flex h-[24px] items-center gap-2 rounded-md px-2.5 text-[12px] font-medium no-underline"
          style={{ color: settingsOpen ? 'var(--text)' : 'var(--muted)' }}
          title="Settings (⌘,)"
        >
          <IconSettings size={14} />
          Settings
        </a>
      </div>
    </nav>
  );
}

function SourceGroup({ name, children }: { name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-[22px] items-center gap-1 px-2.5 text-[12px] font-medium"
        style={{ color: 'var(--muted)' }}
      >
        {name}
        {open ? <IconTriangleDown size={12} /> : <IconTriangleRight size={12} />}
      </button>
      {open && <ul className="m-0 list-none p-0">{children}</ul>}
    </div>
  );
}

function NavLink({
  id,
  label,
  shortcut,
  active,
  onSelect,
  badge,
}: {
  id: SectionId;
  label: string;
  shortcut: string;
  active: boolean;
  onSelect: (id: SectionId) => void;
  badge?: number;
}) {
  const Icon = ICONS[id];
  return (
    <a
      href={`#${id}`}
      aria-current={active ? 'page' : undefined}
      title={`${label} (⌘${shortcut})`}
      onClick={(e) => {
        e.preventDefault();
        onSelect(id);
      }}
      className="flex h-[24px] items-center gap-2.5 rounded-md px-2.5 text-[12.5px] font-medium no-underline"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--on-accent)' : 'var(--text)',
      }}
    >
      <Icon size={14} />
      <span className="flex-1">{label}</span>
      {badge != null && (
        <span aria-hidden="true" className="text-[11px] font-semibold tabular-nums" style={{ color: active ? 'var(--on-accent)' : 'var(--accent)' }}>
          {badge}
        </span>
      )}
    </a>
  );
}

/** Copilot's refresh and back/forward arrows beside the logo. */
function HistoryButtons() {
  const refresh = useNavStore((s) => s.refresh);
  const goBack = useNavStore((s) => s.goBack);
  const goForward = useNavStore((s) => s.goForward);
  const canBack = useNavStore((s) => s.back.length > 0);
  const canForward = useNavStore((s) => s.forward.length > 0);
  const cls = 'flex h-[22px] w-[22px] items-center justify-center rounded-md hover:bg-[var(--hover)] disabled:opacity-35 disabled:hover:bg-transparent';
  return (
    <div className="ml-auto flex items-center gap-0.5" style={{ color: 'var(--muted)' }}>
      <button type="button" aria-label="Refresh" title="Refresh (⌘R)" onClick={refresh} className={cls}>
        <IconRefresh size={13} />
      </button>
      <button type="button" aria-label="Back" title="Back (⌘[)" disabled={!canBack} onClick={goBack} className={cls}>
        <IconChevronLeft size={14} />
      </button>
      <button type="button" aria-label="Forward" title="Forward (⌘])" disabled={!canForward} onClick={goForward} className={cls}>
        <IconChevronRight size={14} />
      </button>
    </div>
  );
}
