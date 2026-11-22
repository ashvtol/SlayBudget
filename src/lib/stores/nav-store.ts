import type { NotificationTarget } from '@/lib/types';
import { create } from 'zustand';

export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', shortcut: '1' },
  { id: 'transactions', label: 'Transactions', shortcut: '2' },
  { id: 'cashflow', label: 'Cash flow', shortcut: '3' },
  { id: 'categories', label: 'Categories', shortcut: '4' },
  { id: 'recurring', label: 'Recurrings', shortcut: '5' },
  { id: 'insights', label: 'Insights', shortcut: '6' },
  { id: 'import', label: 'Import', shortcut: '7' },
  { id: 'settings', label: 'Settings', shortcut: ',' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

interface NavState {
  /** The screen shown. Never 'settings': Settings opens as a panel over it. */
  section: SectionId;
  settingsOpen: boolean;
  /** The Settings section to show when it opens (e.g. 'tags' from a tag picker); null = the list. */
  settingsPane: string | null;
  openSettingsPane(pane: string): void;
  go(section: SectionId): void;
  closeSettings(): void;
  /** Set when another screen asks Categories to open Clean up Other; Categories clears it. */
  cleanUpOther: boolean;
  openCleanUpOther(): void;
  clearCleanUpOther(): void;
  /** Screens visited before (most recent last) and after the current one (Copilot's back/forward). */
  back: SectionId[];
  forward: SectionId[];
  goBack(): void;
  goForward(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  /**
   * Something to open on arrival (a bill on Recurrings, a category and month on Categories), set by a notification.
   * The screen applies it once its data is in, then clears it.
   */
  intent: { target: NotificationTarget; seq: number } | null;
  openIntent(target: NotificationTarget): void;
  clearIntent(): void;
  /** Bumped by Cmd+R / the refresh button; the shown screen re-reads its data. */
  refreshTick: number;
  refresh(): void;
}

const HISTORY_LIMIT = 50;

/** Move to `section`, remembering where we were (new steps drop the forward history). */
function visit(state: { section: SectionId; back: SectionId[] }, section: SectionId) {
  if (section === state.section) return {};
  return { section, back: [...state.back, state.section].slice(-HISTORY_LIMIT), forward: [] as SectionId[] };
}

export const useNavStore = create<NavState>((set, get) => ({
  section: 'dashboard',
  settingsOpen: false,
  settingsPane: null,
  openSettingsPane: (pane) => set({ settingsOpen: true, settingsPane: pane }),
  go: (section) => (section === 'settings' ? set({ settingsOpen: true }) : set((s) => ({ ...visit(s, section), settingsOpen: false, settingsPane: null }))),
  closeSettings: () => set({ settingsOpen: false, settingsPane: null }),
  cleanUpOther: false,
  openCleanUpOther: () => set((s) => ({ ...visit(s, 'categories'), settingsOpen: false, cleanUpOther: true })),
  clearCleanUpOther: () => set({ cleanUpOther: false }),
  intent: null,
  openIntent: (target) =>
    set((s) => ({
      ...visit(s, target.kind === 'recurring' ? 'recurring' : 'categories'),
      settingsOpen: false,
      settingsPane: null,
      intent: { target, seq: (s.intent?.seq ?? 0) + 1 },
    })),
  clearIntent: () => set({ intent: null }),
  back: [],
  forward: [],
  goBack: () =>
    set((s) => {
      const previous = s.back[s.back.length - 1];
      if (!previous) return {};
      return { section: previous, back: s.back.slice(0, -1), forward: [s.section, ...s.forward], settingsOpen: false, settingsPane: null };
    }),
  goForward: () =>
    set((s) => {
      const [next, ...rest] = s.forward;
      if (!next) return {};
      return { section: next, back: [...s.back, s.section].slice(-HISTORY_LIMIT), forward: rest, settingsOpen: false, settingsPane: null };
    }),
  canGoBack: () => get().back.length > 0,
  canGoForward: () => get().forward.length > 0,
  refreshTick: 0,
  refresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));

/** Map a Cmd+key press to a section, or null when the key is not bound. */
export function sectionForShortcut(key: string): SectionId | null {
  return SECTIONS.find((s) => s.shortcut === key)?.id ?? null;
}
