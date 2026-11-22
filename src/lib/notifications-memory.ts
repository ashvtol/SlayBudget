// In-memory notification inbox, mirroring crates/core/src/notifications.rs for tests and the browser preview.
import type { AppNotification, NewNotification } from './types';

const KEEP_DAYS = 90;
const KEEP_MAX = 200;

export function createNotificationInbox(now: () => string = () => new Date().toISOString()) {
  const rows: (AppNotification & { dismissed: boolean })[] = [];
  let nextId = 1;
  // A profile sees its own items plus household-wide ones (no profile: recaps, budgets, updates).
  const inScope = (r: AppNotification, profileId: number | null) => profileId == null || r.profileId == null || r.profileId === profileId;
  const newestFirst = (a: AppNotification, b: AppNotification) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
  const view = (r: AppNotification & { dismissed: boolean }): AppNotification => {
    const { id, key, kind, title, body, target, profileId, createdAt, read, delivered } = r;
    return { id, key, kind, title, body, target: { ...target }, profileId, createdAt, read, delivered };
  };

  return {
    add(n: NewNotification, read: boolean, at = now()): AppNotification | null {
      if (rows.some((r) => r.key === n.key)) return null;
      const row = { ...n, target: { ...n.target }, id: nextId++, createdAt: at, read, delivered: read, dismissed: false };
      rows.push(row);
      return view(row);
    },
    list(profileId: number | null): AppNotification[] {
      return rows.filter((r) => !r.dismissed && inScope(r, profileId)).sort(newestFirst).slice(0, KEEP_MAX).map(view);
    },
    markRead(id: number) {
      const r = rows.find((x) => x.id === id);
      if (r) r.read = true;
    },
    markAllRead(profileId: number | null) {
      for (const r of rows) if (inScope(r, profileId)) r.read = true;
    },
    dismiss(id: number) {
      const r = rows.find((x) => x.id === id);
      if (r) Object.assign(r, { dismissed: true, read: true });
    },
    pending(profileId: number | null): AppNotification[] {
      return rows
        .filter((r) => !r.delivered && !r.read && !r.dismissed && inScope(r, profileId))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
        .map(view);
    },
    markDelivered(ids: number[]) {
      for (const r of rows) if (ids.includes(r.id)) r.delivered = true;
    },
    prune(at = now()) {
      const cutoff = new Date(Date.parse(at) - KEEP_DAYS * 86_400_000).toISOString();
      const keep = rows.filter((r) => r.createdAt >= cutoff).sort(newestFirst).slice(0, KEEP_MAX);
      rows.splice(0, rows.length, ...keep);
    },
  };
}
