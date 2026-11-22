// The bell's inbox: notifications for the active profile, newest first.
import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { AppNotification } from '@/lib/types';

interface InboxState {
  items: AppNotification[];
  /** The bell's panel (opened by a clicked summary banner too). */
  open: boolean;
  setOpen(open: boolean): void;
  load(): Promise<void>;
  markRead(id: number): Promise<void>;
  markAllRead(): Promise<void>;
  dismiss(id: number): Promise<void>;
}

const profile = () => useProfileStore.getState().activeProfileId ?? null;

export const useInboxStore = create<InboxState>((set, get) => ({
  items: [],
  open: false,
  setOpen(open) {
    set({ open });
  },
  async load() {
    try {
      set({ items: await ipc().notificationsList(profile()) });
    } catch {
      /* the bell is best-effort: a failed load keeps what it showed */
    }
  },
  async markRead(id) {
    set({ items: get().items.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    await ipc().notificationsMarkRead(id);
  },
  async markAllRead() {
    set({ items: get().items.map((n) => ({ ...n, read: true })) });
    await ipc().notificationsMarkAllRead(profile());
  },
  async dismiss(id) {
    set({ items: get().items.filter((n) => n.id !== id) });
    await ipc().notificationsDismiss(id);
  },
}));

export const unreadCount = (items: AppNotification[]) => items.filter((n) => !n.read).length;
