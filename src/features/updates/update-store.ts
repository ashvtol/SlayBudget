// Continuous updates: check on launch and every 6 hours, ask before installing, and show the changelog for every
// version between the installed one and the new one (the release's notes carry the full CHANGELOG.md).

import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { isTauri } from '@/lib/tauri-ipc';
import { changelogBetween, type ChangelogSection } from '@/lib/changelog';

type DownloadEvent = { event: string; data?: { contentLength?: number; chunkLength?: number } };

export interface UpdateHandle {
  version: string;
  body?: string | null;
  date?: string | null;
  downloadAndInstall(onEvent?: (e: DownloadEvent) => void): Promise<void>;
}

/** What the store needs from Tauri; swapped for fakes in tests. */
export interface UpdaterDeps {
  supported(): boolean;
  currentVersion(): Promise<string>;
  check(): Promise<UpdateHandle | null>;
  relaunch(): Promise<void>;
}

const tauriDeps: UpdaterDeps = {
  supported: isTauri,
  async currentVersion() {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },
  async check() {
    const { check } = await import('@tauri-apps/plugin-updater');
    return (await check()) as UpdateHandle | null;
  },
  async relaunch() {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
};

const DISMISSED_KEY = 'updates.dismissed';

/** Put a found update in the bell (once per version), and banner it like any other notification. */
async function notifyUpdate(version: string) {
  try {
    const added = await ipc().notificationsAdd(
      {
        key: `update:${version}`,
        kind: 'update',
        title: `SlayBudget ${version} is available`,
        body: "See what's new and install when you like.",
        target: { kind: 'update' },
        profileId: null,
      },
      false,
    );
    if (!added) return;
    const { useNotificationsStore } = await import('@/features/notifications/notifications-store');
    const { useInboxStore } = await import('@/features/notifications/inbox-store');
    await useInboxStore.getState().load();
    await useNotificationsStore.getState().deliverPending();
  } catch {
    /* the bell is best-effort; the update dialog still works */
  }
}
const FIRST_CHECK_MS = 5_000;
const EVERY_MS = 6 * 3_600_000;

type Status = 'idle' | 'checking' | 'uptodate' | 'available' | 'installing' | 'error' | 'unsupported';

interface UpdateState {
  status: Status;
  currentVersion: string | null;
  available: { version: string; date: string | null; notes: string } | null;
  /** Changelog sections after the installed version up to the new one, newest first. */
  sections: ChangelogSection[];
  dialogOpen: boolean;
  progress: { downloaded: number; total: number | null } | null;
  lastChecked: Date | null;
  error: string | null;
  configure(deps: UpdaterDeps): void;
  reset(): void;
  checkNow(opts?: { auto?: boolean }): Promise<void>;
  openDialog(): void;
  later(): Promise<void>;
  install(): Promise<void>;
  /** Start the launch and periodic checks; returns a function that stops them. */
  startAutoCheck(): () => void;
}

let deps: UpdaterDeps = tauriDeps;
let handle: UpdateHandle | null = null;

const initial = {
  status: 'idle' as Status,
  currentVersion: null,
  available: null,
  sections: [],
  dialogOpen: false,
  progress: null,
  lastChecked: null,
  error: null,
};

export const useUpdateStore = create<UpdateState>((set, get) => ({
  ...initial,

  configure(d) {
    deps = d;
  },
  reset() {
    deps = tauriDeps;
    handle = null;
    set({ ...initial });
  },

  async checkNow({ auto = false } = {}) {
    if (!deps.supported()) {
      set({ status: 'unsupported' });
      return;
    }
    if (get().status === 'checking' || get().status === 'installing') return;
    set({ status: 'checking', error: null });
    try {
      const current = get().currentVersion ?? (await deps.currentVersion());
      const update = await deps.check();
      handle = update;
      if (!update) {
        set({ status: 'uptodate', currentVersion: current, available: null, sections: [], lastChecked: new Date() });
        return;
      }
      const notes = update.body ?? '';
      void notifyUpdate(update.version);
      const dismissed = auto ? await ipc().getSetting(DISMISSED_KEY) : null;
      set({
        status: 'available',
        currentVersion: current,
        available: { version: update.version, date: update.date ?? null, notes },
        sections: changelogBetween(notes, current, update.version),
        dialogOpen: get().dialogOpen || dismissed !== update.version,
        lastChecked: new Date(),
      });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), lastChecked: new Date() });
    }
  },

  openDialog() {
    if (get().available) set({ dialogOpen: true });
  },

  async later() {
    const version = get().available?.version;
    set({ dialogOpen: false });
    if (version) await ipc().setSetting(DISMISSED_KEY, version);
  },

  async install() {
    if (!handle) return;
    set({ status: 'installing', progress: { downloaded: 0, total: null }, error: null });
    try {
      await handle.downloadAndInstall((e) => {
        const p = get().progress ?? { downloaded: 0, total: null };
        if (e.event === 'Started') set({ progress: { downloaded: 0, total: e.data?.contentLength ?? null } });
        else if (e.event === 'Progress') set({ progress: { ...p, downloaded: p.downloaded + (e.data?.chunkLength ?? 0) } });
      });
      await deps.relaunch();
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },

  startAutoCheck() {
    if (!deps.supported()) return () => {};
    const run = () => void get().checkNow({ auto: true });
    const first = setTimeout(run, FIRST_CHECK_MS);
    const every = setInterval(run, EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  },
}));
