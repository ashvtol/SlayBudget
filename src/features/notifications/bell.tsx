import { useEffect, useRef } from 'react';
import { IconBell, IconClose } from '@/components/icons';
import type { AppNotification, NotificationKind } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { openTarget } from './route';
import { unreadCount, useInboxStore } from './inbox-store';

const ICON: Record<NotificationKind, string> = {
  update: '⬆️',
  billUpcoming: '🗓️',
  billMissed: '⚠️',
  priceUp: '📈',
  doubleCharge: '👯',
  largeTransaction: '💸',
  overBudget: '🎯',
  monthlyRecap: '🧾',
  reviewDigest: '✅',
  moneyIn: '💰',
  possibleDuplicates: '👯',
};

/** "Just now", "5m", "3h", "2d" (or the date after a week). */
function ago(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupOf(iso: string, now = new Date()): 'Today' | 'This week' | 'Earlier' {
  const d = new Date(iso);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= start) return 'Today';
  return start.getTime() - d.getTime() < 6 * 86_400_000 ? 'This week' : 'Earlier';
}

/** The bell in every screen's top bar: unread count, and a panel listing notifications that open their views. */
export function NotificationBell() {
  const items = useInboxStore((s) => s.items);
  const { load, markRead, markAllRead, dismiss } = useInboxStore();
  const profile = useProfileStore((s) => s.activeProfileId);
  const open = useInboxStore((s) => s.open);
  const setOpen = useInboxStore((s) => s.setOpen);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void load();
  }, [load, profile]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, setOpen]);

  const unread = unreadCount(items);
  const go = (n: AppNotification) => {
    setOpen(false);
    void markRead(n.id);
    void openTarget(n.target);
  };
  const groups = (['Today', 'This week', 'Earlier'] as const)
    .map((g) => [g, items.filter((n) => groupOf(n.createdAt) === g)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <div ref={ref} className="relative" data-tauri-drag-region={false}>
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen(!open)}
        className="relative flex h-[28px] w-[28px] items-center justify-center rounded-md hover:bg-[var(--hover)]"
        style={{ color: open ? 'var(--text)' : 'var(--muted)' }}
      >
        <IconBell size={15} />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-1 -top-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-bold" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-[34px] z-50 flex max-h-[480px] w-[380px] flex-col overflow-hidden rounded-xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="flex items-center justify-between border-b px-4 py-2.5" style={{ borderColor: 'var(--line)' }}>
            <span className="text-[13px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                Mark all as read
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {items.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-[13px]" style={{ color: 'var(--muted)' }}>You're all caught up.</p>
            ) : (
              groups.map(([g, list]) => (
                <section key={g} aria-label={g}>
                  <div className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--subtle)' }}>{g}</div>
                  {list.map((n) => (
                    <div key={n.id} className="group flex items-center gap-1 pr-3 hover:bg-[var(--hover)]">
                      <button type="button" onClick={() => go(n)} className="flex min-w-0 flex-1 items-start gap-3 py-2 pl-4 text-left">
                        <span aria-hidden="true" className="mt-0.5 text-[15px] leading-none">{ICON[n.kind]}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-[13px] ${n.read ? 'font-medium' : 'font-semibold'}`} style={{ color: n.read ? 'var(--muted)' : 'var(--text)' }}>
                            {n.title}
                          </span>
                          <span className="block text-[12px] leading-snug" style={{ color: 'var(--muted)' }}>{n.body}</span>
                        </span>
                      </button>
                      {/* The time (and unread dot) and the dismiss button share this spot; hovering swaps them. */}
                      <span className="flex min-w-[44px] shrink-0 flex-col items-end justify-center gap-1.5 self-stretch whitespace-nowrap">
                        <span className="text-[11px] group-hover:hidden" style={{ color: 'var(--subtle)' }}>{ago(n.createdAt)}</span>
                        {!n.read && <span aria-label="Unread" role="img" className="h-[6px] w-[6px] rounded-full group-hover:hidden" style={{ background: 'var(--accent)' }} />}
                        <button
                          type="button"
                          aria-label={`Dismiss ${n.title}`}
                          title="Dismiss"
                          onClick={() => void dismiss(n.id)}
                          className="hidden h-[22px] w-[22px] items-center justify-center rounded-md hover:bg-[var(--line)] group-hover:flex"
                          style={{ color: 'var(--muted)' }}
                        >
                          <IconClose size={11} />
                        </button>
                      </span>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
