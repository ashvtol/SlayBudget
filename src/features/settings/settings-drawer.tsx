import { type ComponentType, type ReactNode } from 'react';
import { Drawer } from '@/components/drawer';
import { IconBank, IconCard, IconChevronRight, IconImport, IconNote, IconRefresh, IconSettings, IconHelp, IconTag, IconCategories, IconCalendar } from '@/components/icons';
import { useNavStore } from '@/lib/stores/nav-store';
import { THEMES, useThemeStore } from '@/lib/stores/theme-store';
import { useCurrencyStore } from '@/features/currency/currency-store';
import { CurrencyPane } from '@/features/currency/currency-pane';
import { NotificationsPane } from '@/features/notifications/notifications-pane';
import { AppearancePane } from './appearance-pane';
import { ProfilesPane } from './profiles-pane';
import { DataPane } from './data-pane';
import { ImportSourcesPane } from './import-sources-pane';
import { AccountsPane } from './accounts-pane';
import { UpdatesPane } from './updates-pane';
import { AboutPane } from './about-pane';
import { BankConnectionsPane } from './bank-connections-pane';
import { TagsPane } from './tags-pane';
import { RolloversPane } from './rollovers-pane';
import { AccessibilityPane } from './accessibility-pane';
import { CategorizationPane } from './categorization-pane';

type PaneId = 'accounts' | 'tags' | 'categorization' | 'rollovers' | 'accessibility' | 'theme' | 'profiles' | 'currency' | 'sources' | 'bank' | 'notifications' | 'data' | 'updates' | 'about';

const PANES: Record<PaneId, { title: string; render: () => ReactNode }> = {
  accounts: { title: 'Accounts', render: () => <AccountsPane /> },
  tags: { title: 'Tags', render: () => <TagsPane /> },
  categorization: { title: 'Categorization', render: () => <CategorizationPane /> },
  rollovers: { title: 'Rollovers', render: () => <RolloversPane /> },
  accessibility: { title: 'Accessibility', render: () => <AccessibilityPane /> },
  theme: { title: 'Theme', render: () => <AppearancePane /> },
  profiles: { title: 'Profiles', render: () => <ProfilesPane /> },
  currency: { title: 'Currency', render: () => <CurrencyPane /> },
  sources: { title: 'Import sources', render: () => <ImportSourcesPane /> },
  bank: { title: 'Bank connections', render: () => <BankConnectionsPane /> },
  notifications: { title: 'Notifications and reminders', render: () => <NotificationsPane /> },
  data: { title: 'Data and backup', render: () => <DataPane /> },
  updates: { title: 'Updates', render: () => <UpdatesPane /> },
  about: { title: 'About', render: () => <AboutPane /> },
};

/** Copilot-style Settings: a right-hand panel of grouped rows; a row opens its section. */
export function SettingsDrawer() {
  const open = useNavStore((s) => s.settingsOpen);
  const close = useNavStore((s) => s.closeSettings);
  // The open section lives in the nav store, so a tag picker can open Settings at Tags.
  const stored = useNavStore((s) => s.settingsPane);
  const pane = stored != null && stored in PANES ? (stored as PaneId) : null;
  const setPane = (p: PaneId | null) => useNavStore.setState({ settingsPane: p });
  const onClose = () => close();

  return (
    <Drawer open={open} title="Settings" onClose={onClose} width={520}>
      {pane ? (
        <div className="flex flex-col gap-5 px-6 py-5">
          <button type="button" aria-label="Back to Settings" onClick={() => setPane(null)} className="flex w-fit items-center gap-1 text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
            <IconChevronRight size={12} style={{ transform: 'rotate(180deg)' }} />
            Settings
          </button>
          <h2 className="m-0 text-[18px] font-semibold">{PANES[pane].title}</h2>
          {PANES[pane].render()}
        </div>
      ) : (
        <SettingsList onOpen={setPane} />
      )}
    </Drawer>
  );
}

function SettingsList({ onOpen }: { onOpen: (p: PaneId) => void }) {
  const theme = useThemeStore((s) => s.theme);
  const display = useCurrencyStore((s) => s.displayCurrency);
  const themeName = THEMES.find((t) => t.id === theme)?.name ?? '';
  return (
    <div className="flex flex-col gap-6 py-5">
      <Group label="Features">
        <Row icon={IconTag} label="Tags" onClick={() => onOpen('tags')} />
        <Row icon={IconCategories} label="Categorization" onClick={() => onOpen('categorization')} />
        <Row icon={IconRefresh} label="Rollovers" onClick={() => onOpen('rollovers')} />
      </Group>
      <Group label="Appearance">
        <Row icon={IconCategories} label="Theme" value={themeName} onClick={() => onOpen('theme')} />
        <Row icon={IconHelp} label="Accessibility" onClick={() => onOpen('accessibility')} />
      </Group>
      <Group label="General">
        <Row icon={IconSettings} label="Profiles" onClick={() => onOpen('profiles')} />
        <Row icon={IconTag} label="Currency" value={display} onClick={() => onOpen('currency')} />
        <Row icon={IconCard} label="Accounts" onClick={() => onOpen('accounts')} />
        <Row icon={IconImport} label="Import sources" onClick={() => onOpen('sources')} />
        <Row icon={IconBank} label="Bank connections" onClick={() => onOpen('bank')} />
      </Group>
      <Group label="Notifications">
        <Row icon={IconCalendar} label="Notifications and reminders" onClick={() => onOpen('notifications')} />
      </Group>
      <Group label="Data">
        <Row icon={IconNote} label="Data and backup" onClick={() => onOpen('data')} />
      </Group>
      <Group label="App">
        <Row icon={IconRefresh} label="Updates" onClick={() => onOpen('updates')} />
        <Row icon={IconHelp} label="About" onClick={() => onOpen('about')} />
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <div className="label-caps mb-1 px-6" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Row({ icon: Icon, label, value, onClick }: { icon: ComponentType<{ size?: number }>; label: string; value?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[36px] items-center gap-3 border-b px-6 text-left text-[13px] hover:bg-[var(--hover)]"
      style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
    >
      <span style={{ color: 'var(--muted)' }}><Icon size={15} /></span>
      <span className="flex-1">{label}</span>
      {value && <span className="text-[12px]" style={{ color: 'var(--muted)' }}>{value}</span>}
      <span style={{ color: 'var(--subtle)' }}><IconChevronRight size={13} /></span>
    </button>
  );
}
