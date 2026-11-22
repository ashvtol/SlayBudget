// Notification delivery: run the producers (on launch, after imports, hourly), keep the bell current, and show macOS
// banners for new items, respecting per-kind switches and quiet hours, batching more than 3 into one summary.

import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { todayStr } from '@/features/analytics/analytics-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import { inQuietHours, loadConfig } from './config';
import { useInboxStore } from './inbox-store';
import { ensurePermission, sendBanner } from './notify';
import { openTarget } from './route';
import { useNavStore } from '@/lib/stores/nav-store';

const KEY_ENABLED = 'notifications_enabled';
const FIRST_CHECK_MS = 3_000;
const CHECK_EVERY_MS = 60 * 60_000;
const DELIVER_EVERY_MS = 15 * 60_000;
const BATCH_OVER = 3;

export interface DeliveryDeps {
  sendBanner(id: string, title: string, body: string): Promise<void>;
  now(): Date;
}
let deps: DeliveryDeps = { sendBanner, now: () => new Date() };

interface NotificationsState {
  /** macOS banners on or off (the bell always collects). */
  enabled: boolean;
  loaded: boolean;
  configure(d: DeliveryDeps): void;
  load(): Promise<void>;
  setEnabled(v: boolean): Promise<void>;
  /** Run the producers, refresh the bell, then deliver banners. */
  checkNow(opts?: { baseline?: boolean }): Promise<void>;
  /** Show banners for items not yet bannered (unless quiet hours hold them). */
  deliverPending(): Promise<void>;
  /** A clicked banner: open its item, or the bell for a summary. */
  handleClick(id: string): Promise<void>;
  startScheduler(): () => void;
}

const profile = () => useProfileStore.getState().activeProfileId ?? null;

export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  enabled: false,
  loaded: false,
  configure(d) {
    deps = d;
  },
  async load() {
    set({ enabled: (await ipc().getSetting(KEY_ENABLED)) === 'true', loaded: true });
  },
  async setEnabled(v) {
    set({ enabled: v });
    await ipc().setSetting(KEY_ENABLED, String(v));
    if (v) await ensurePermission();
  },
  async checkNow({ baseline = false } = {}) {
    try {
      await ipc().notificationsRefresh(todayStr(deps.now()), baseline);
    } catch {
      /* a failed check retries on the next tick */
    }
    await useInboxStore.getState().load();
    await get().deliverPending();
  },
  async deliverPending() {
    const pending = await ipc().notificationsPending(profile());
    if (pending.length === 0) return;
    if (!get().enabled) {
      // Banners are off: everything stays in the bell, nothing is held for later.
      await ipc().notificationsMarkDelivered(pending.map((n) => n.id));
      return;
    }
    const config = await loadConfig(ipc());
    if (inQuietHours(config.quietHours, deps.now())) return;
    const wanted = pending.filter((n) => config.kinds[n.kind]?.banner !== false);
    if (wanted.length > BATCH_OVER) {
      const lines = wanted.slice(0, 3).map((n) => n.title);
      await deps.sendBanner('bell', `${wanted.length} new alerts in SlayBudget`, `${lines.join(' · ')}${wanted.length > 3 ? ' · …' : ''}`);
    } else {
      for (const n of wanted) await deps.sendBanner(String(n.id), n.title, n.body);
    }
    await ipc().notificationsMarkDelivered(pending.map((n) => n.id));
  },
  async handleClick(id) {
    if (id === 'bell') {
      useNavStore.getState().closeSettings(); // the bell lives in the page's top bar, under Settings
      await useInboxStore.getState().load();
      useInboxStore.getState().setOpen(true);
      return;
    }
    const n = (await ipc().notificationsList(null)).find((x) => String(x.id) === id);
    if (!n) return;
    await useInboxStore.getState().markRead(n.id);
    await openTarget(n.target);
  },
  startScheduler() {
    const first = setTimeout(() => void get().checkNow(), FIRST_CHECK_MS);
    const hourly = setInterval(() => void get().checkNow(), CHECK_EVERY_MS);
    const deliver = setInterval(() => void get().deliverPending(), DELIVER_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(hourly);
      clearInterval(deliver);
    };
  },
}));
