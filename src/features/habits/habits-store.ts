// Your money style, targets and hidden tips (saved in settings), and the history they're worked out from. Shared by
// Insights and the Dashboard so a choice made on one shows on the other.

import { useEffect } from 'react';
import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import type { Category, HabitsData, Recurring } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useScreen } from '@/app/shell/screen';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { MAX_TARGET, MIN_TARGET, type HiddenTip, type Style, type Tip } from './habits-model';

export const KEYS = { style: 'money_style', fire: 'habits_target_fire', soft: 'habits_target_soft', hidden: 'hidden_tips', choices: 'habits_budget_choices' } as const;

interface HabitsState {
  settingsLoaded: boolean;
  style: Style;
  /** Chosen targets; null means "use the default for my savings rate". */
  targets: Record<Style, number | null>;
  hidden: HiddenTip[];
  /** Categories put in or left out of the suggested budget. */
  choices: Record<number, boolean>;
  data: HabitsData | null;
  categories: Category[];
  recurring: Recurring[];
  hasSavings: boolean;
  loadSettings(): Promise<void>;
  loadData(profileId: number | null, today: string): Promise<void>;
  setStyle(style: Style): Promise<void>;
  setTarget(style: Style, target: number): Promise<void>;
  hide(tip: Tip, today: string): Promise<void>;
  unhide(id: string): Promise<void>;
  choose(categoryId: number, included: boolean): Promise<void>;
  /** Put every listed category in, or leave them all out. */
  chooseAll(categoryIds: number[], included: boolean): Promise<void>;
}

export const parseTarget = (v: string | null) => {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(MAX_TARGET, Math.max(MIN_TARGET, n)) : null;
};
export const parseChoices = (v: string | null): Record<number, boolean> => {
  try {
    const o = v ? JSON.parse(v) : {};
    return o && typeof o === 'object' && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o).filter(([k, b]) => Number.isFinite(Number(k)) && typeof b === 'boolean').map(([k, b]) => [Number(k), b as boolean]))
      : {};
  } catch {
    return {};
  }
};
export const parseHidden = (v: string | null): HiddenTip[] => {
  try {
    const list = v ? JSON.parse(v) : [];
    return Array.isArray(list) ? list.filter((h) => h && typeof h.id === 'string' && typeof h.value === 'number') : [];
  } catch {
    return [];
  }
};

export const useHabitsStore = create<HabitsState>((set, get) => ({
  settingsLoaded: false,
  style: 'fire',
  targets: { fire: null, soft: null },
  hidden: [],
  choices: {},
  data: null,
  categories: [],
  recurring: [],
  hasSavings: false,

  async loadSettings() {
    const [style, fire, soft, hidden, choices] = await Promise.all([KEYS.style, KEYS.fire, KEYS.soft, KEYS.hidden, KEYS.choices].map((k) => ipc().getSetting(k)));
    set({
      settingsLoaded: true,
      style: style === 'soft' ? 'soft' : 'fire',
      targets: { fire: parseTarget(fire), soft: parseTarget(soft) },
      hidden: parseHidden(hidden),
      choices: parseChoices(choices),
    });
  },
  async loadData(profileId, today) {
    const [data, categories, recurring, sources] = await Promise.all([
      ipc().moneyHabits(profileId, today),
      ipc().listCategories(),
      ipc().analyticsRecurring(profileId, today),
      ipc().listSources(),
    ]);
    set({ data, categories, recurring, hasSavings: sources.some((s) => s.accountType === 'savings') });
  },
  async setStyle(style) {
    set({ style });
    await ipc().setSetting(KEYS.style, style);
  },
  async setTarget(style, target) {
    const t = Math.min(MAX_TARGET, Math.max(MIN_TARGET, target));
    set({ targets: { ...get().targets, [style]: t } });
    await ipc().setSetting(KEYS[style], String(t));
  },
  async hide(tip, today) {
    const hidden = [...get().hidden.filter((h) => h.id !== tip.id), { id: tip.id, hiddenAt: today, value: tip.value }];
    set({ hidden });
    await ipc().setSetting(KEYS.hidden, JSON.stringify(hidden));
  },
  async choose(categoryId, included) {
    const choices = { ...get().choices, [categoryId]: included };
    set({ choices });
    await ipc().setSetting(KEYS.choices, JSON.stringify(choices));
  },
  async chooseAll(categoryIds, included) {
    const choices = { ...get().choices, ...Object.fromEntries(categoryIds.map((id) => [id, included])) };
    set({ choices });
    await ipc().setSetting(KEYS.choices, JSON.stringify(choices));
  },
  async unhide(id) {
    const hidden = get().hidden.filter((h) => h.id !== id);
    set({ hidden });
    await ipc().setSetting(KEYS.hidden, JSON.stringify(hidden));
  },
}));

/** Loads the settings once and the history whenever the profile, the day or the screen's return changes. */
export function useHabitsData() {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const settingsLoaded = useHabitsStore((s) => s.settingsLoaded);
  const loadSettings = useHabitsStore((s) => s.loadSettings);
  const loadData = useHabitsStore((s) => s.loadData);
  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);
  useEffect(() => {
    void loadData(profileId, today);
  }, [loadData, profileId, today, activation]);
}
