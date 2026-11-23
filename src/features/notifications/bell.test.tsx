import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { NewNotification } from '@/lib/types';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { useUpdateStore } from '@/features/updates/update-store';
import { useInboxStore } from './inbox-store';
import { NotificationBell } from './bell';

const n = (key: string, over: Partial<NewNotification> = {}): NewNotification => ({
  key, kind: 'billUpcoming', title: `Title ${key}`, body: `Body ${key}`, target: { kind: 'recurring', id: 7 }, profileId: null, ...over,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  setIpc(createMemoryIpc());
  useInboxStore.setState({ items: [], open: false });
  useNavStore.setState({ section: 'dashboard', settingsOpen: false, intent: null });
});

async function seed(list: NewNotification[]) {
  for (const x of list) await ipc().notificationsAdd(x, false);
  await act(() => useInboxStore.getState().load());
}

describe('NotificationBell', () => {
  it('shows the unread count, capped at 9+', async () => {
    await seed(Array.from({ length: 12 }, (_, i) => n(`k${i}`)));
    render(<NotificationBell />);
    expect(screen.getByRole('button', { name: 'Notifications, 12 unread' })).toHaveTextContent('9+');
  });

  it('lists items newest first with an empty state, marks all read and dismisses', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toHaveTextContent("You're all caught up.");
    await user.keyboard('{Escape}');
    await seed([n('a', { title: 'Netflix is due in 3 days' }), n('b', { title: 'Large transaction', kind: 'largeTransaction' })]);
    await user.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    const rows = within(panel).getAllByRole('button', { name: /Netflix|Large/ });
    expect(rows[0]).toHaveTextContent('Large transaction');
    expect(within(panel).getByText('Today')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Dismiss Netflix is due in 3 days' }));
    expect(within(panel).queryByText('Netflix is due in 3 days')).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument());
  });

  it('clicking an item marks it read, closes the panel and opens its view', async () => {
    const user = userEvent.setup();
    await seed([n('bill', { title: 'Netflix is due in 3 days', target: { kind: 'recurring', id: 7 } })]);
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    await user.click(screen.getByRole('button', { name: /^.{0,4}Netflix is due in 3 days/ }));
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
    expect(useNavStore.getState().section).toBe('recurring');
    expect(useNavStore.getState().intent?.target).toEqual({ kind: 'recurring', id: 7 });
    expect((await ipc().notificationsList(null))[0].read).toBe(true);
  });
});

describe('NotificationBell on every screen', () => {
  // Visited screens stay alive, each with its own bell; they share the open state. A click inside the panel you see
  // must not count as "outside" for the bells on hidden screens (that closed the panel before the × got the click).
  it('dismissing in one bell’s panel works while other screens’ bells are mounted', async () => {
    const user = userEvent.setup();
    await seed([n('a', { title: 'Paycheck arrived' }), n('b')]);
    render(
      <>
        <div data-testid="screen-1"><NotificationBell /></div>
        <div data-testid="screen-2"><NotificationBell /></div>
      </>,
    );
    await user.click(within(screen.getByTestId('screen-1')).getByRole('button', { name: /^Notifications/ }));
    const panel = within(screen.getByTestId('screen-1')).getByRole('dialog', { name: 'Notifications' });
    await user.click(within(panel).getByRole('button', { name: 'Dismiss Paycheck arrived' }));
    expect(useInboxStore.getState().open).toBe(true);
    expect(within(panel).queryByText('Paycheck arrived')).not.toBeInTheDocument();
    expect((await ipc().notificationsList(null)).map((x) => x.title)).toEqual(['Title b']);
  });
});

describe('openTarget routing', () => {
  it('routes each target kind', async () => {
    const { openTarget } = await import('./route');
    const focus = vi.spyOn(useTransactionsStore.getState(), 'focusById').mockResolvedValue();
    const apply = vi.spyOn(useTransactionsStore.getState(), 'applyFilter').mockResolvedValue();
    const dialog = vi.spyOn(useUpdateStore.getState(), 'openDialog');
    useNavStore.setState({ settingsOpen: true });

    await openTarget({ kind: 'transaction', id: 42 });
    expect(useNavStore.getState()).toMatchObject({ section: 'transactions', settingsOpen: false });
    expect(focus).toHaveBeenCalledWith(42);

    await openTarget({ kind: 'transactions', filter: 'review' });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ reviewed: false }));
    await openTarget({ kind: 'transactions', filter: 'search', text: 'Blue Bottle' });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'Blue Bottle' }));
    const tag = await ipc().createTag('Possible duplicate', '#ddb24a');
    await openTarget({ kind: 'transactions', filter: 'duplicates' });
    expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ tagIds: [tag] }));

    await openTarget({ kind: 'category', id: 50, month: '2026-10' });
    expect(useNavStore.getState().section).toBe('categories');
    expect(useNavStore.getState().intent?.target).toEqual({ kind: 'category', id: 50, month: '2026-10' });

    useUpdateStore.setState({ available: { version: '0.2.0', date: null, notes: '' } });
    await openTarget({ kind: 'update' });
    expect(dialog).toHaveBeenCalled();
  });
});

describe('NotificationBell row layout', () => {
  it('shows the dismiss button in place of the time on hover, not on top of it', async () => {
    const user = userEvent.setup();
    await seed([n('a', { title: 'Astound went up' })]);
    render(<NotificationBell />);
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss Astound went up' });
    const time = screen.getByText('Just now');
    expect(dismiss.className).not.toMatch(/\babsolute\b/);
    expect(dismiss.parentElement).toBe(time.parentElement);
    expect(time.className).toMatch(/group-hover:hidden/);
    expect(dismiss.className).toMatch(/group-hover:flex/);
  });
});
