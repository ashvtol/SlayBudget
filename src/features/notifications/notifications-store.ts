import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { todayStr } from '@/features/analytics/analytics-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import { ensurePermission, notify } from './notify';

const KEY_ENABLED = 'notifications_enabled';
const KEY_HORIZON = 'reminder_horizon_days';
const SEEN_PREFIX = 'slaybudget.notified.';

interface NotificationsState {
  enabled: boolean;
  horizonDays: number;
  loaded: boolean;
  load(): Promise<void>;
  setEnabled(v: boolean): Promise<void>;
  setHorizon(days: number): Promise<void>;
  /** Fetch due reminders and fire any not already shown. Returns count fired. */
  runDueCheck(): Promise<number>;
}

/** Remember which reminder keys were already shown, so we don't re-notify. */
function alreadyNotified(key: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + key) != null;
  } catch {
    return false;
  }
}
function markNotified(key: string): void {
  try {
    localStorage.setItem(SEEN_PREFIX + key, '1');
  } catch {
    /* storage may be unavailable; best-effort only */
  }
}

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  enabled: false,
  horizonDays: 7,
  loaded: false,
  async load() {
    const [enabled, horizon] = await Promise.all([ipc().getSetting(KEY_ENABLED), ipc().getSetting(KEY_HORIZON)]);
    set({ enabled: enabled === 'true', horizonDays: horizon ? Number(horizon) : 7, loaded: true });
  },
  async setEnabled(v) {
    set({ enabled: v });
    await ipc().setSetting(KEY_ENABLED, String(v));
    if (v) await ensurePermission();
  },
  async setHorizon(days) {
    set({ horizonDays: days });
    await ipc().setSetting(KEY_HORIZON, String(days));
  },
  async runDueCheck() {
    const { enabled, horizonDays } = get();
    if (!enabled) return 0;
    const profileId = useProfileStore.getState().activeProfileId;
    const reminders = await ipc().remindersDue(profileId, todayStr(), horizonDays);
    let fired = 0;
    for (const r of reminders) {
      if (alreadyNotified(r.key)) continue;
      await notify(r.title, r.body);
      markNotified(r.key);
      fired++;
    }
    return fired;
  },
}));
