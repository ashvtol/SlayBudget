import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { loadConfig } from './config';
import { useNotificationsStore } from './notifications-store';
import { NotificationsPane } from './notifications-pane';

afterEach(() => cleanup());

async function renderPane() {
  setIpc(createMemoryIpc());
  useNotificationsStore.setState({ enabled: false, loaded: false });
  render(<NotificationsPane />);
  await waitFor(() => expect(useNotificationsStore.getState().loaded).toBe(true));
  await screen.findByRole('group', { name: 'Upcoming bill' });
}
const row = (name: string) => screen.getByRole('group', { name });
const saved = () => loadConfig(ipc());

describe('NotificationsPane', () => {
  it('turns Mac banners on and off', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('switch', { name: 'Mac banners' }));
    await waitFor(() => expect(ipc().getSetting('notifications_enabled')).resolves.toBe('true'));
  });

  it('tunes how many days before a bill, and the due-day reminder; saving re-baselines', async () => {
    const user = userEvent.setup();
    await renderPane();
    const refresh = vi.spyOn(ipc(), 'notificationsRefresh');
    const days = within(row('Upcoming bill')).getByRole('spinbutton', { name: 'Days before' });
    await user.clear(days);
    await user.type(days, '10');
    await user.tab();
    await waitFor(async () => expect((await saved()).billLeadDays).toBe(10));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith(expect.any(String), true), { timeout: 2000 });
    await user.click(within(row('Upcoming bill')).getByRole('switch', { name: 'Again on the due day' }));
    await waitFor(async () => expect((await saved()).billDueDay).toBe(false));
  });

  it('explains an invalid value and does not save it', async () => {
    const user = userEvent.setup();
    await renderPane();
    const days = within(row('Upcoming bill')).getByRole('spinbutton', { name: 'Days before' });
    await user.clear(days);
    await user.type(days, '0');
    await user.tab();
    expect(within(row('Upcoming bill')).getByRole('alert')).toHaveTextContent('between 1 and 30');
    expect((await saved()).billLeadDays).toBe(3);
  });

  it('sets amounts in dollars and saves cents', async () => {
    const user = userEvent.setup();
    await renderPane();
    const amount = within(row('Large transaction')).getByRole('textbox', { name: 'At or above' });
    await user.clear(amount);
    await user.type(amount, '1,000');
    await user.tab();
    await waitFor(async () => expect((await saved()).largeCents).toBe(100000));
  });

  it('switches bell and banner per kind, and sets quiet hours', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(within(row('Price changes')).getByRole('switch', { name: 'Banner' }));
    await waitFor(async () => expect((await saved()).kinds.priceUp).toEqual({ bell: true, banner: false }));
    await user.click(within(row('Monthly recap')).getByRole('switch', { name: 'Bell' }));
    await waitFor(async () => expect((await saved()).kinds.monthlyRecap.bell).toBe(false));
    const start = within(row('Quiet hours')).getByLabelText('From');
    await user.clear(start);
    await user.type(start, '21:30');
    await user.tab();
    await waitFor(async () => expect((await saved()).quietHours.start).toBe('21:30'));
  });

  it('uses slide toggles everywhere, with Bell above Banner, and Banner off while Bell is off', async () => {
    const user = userEvent.setup();
    await renderPane();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    for (const name of ['On', 'Again on the due day', 'When on pace to overspend', 'Paychecks', 'Refunds']) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    }
    const recap = row('Monthly recap');
    const bell = within(recap).getByRole('switch', { name: 'Bell' });
    const banner = within(recap).getByRole('switch', { name: 'Banner' });
    expect(bell.closest('[data-stack]')).toBe(banner.closest('[data-stack]'));
    expect(bell.closest('[data-stack]')).not.toBeNull();
    await user.click(bell);
    await waitFor(() => expect(within(row('Monthly recap')).getByRole('switch', { name: 'Banner' })).toBeDisabled());
  });

  it('saves each toggle at once but re-checks notifications only after the toggling stops', async () => {
    const user = userEvent.setup();
    await renderPane();
    const refresh = vi.spyOn(ipc(), 'notificationsRefresh');
    const recap = () => within(row('Monthly recap')).getByRole('switch', { name: 'Banner' });
    await user.click(recap());
    await user.click(recap());
    await user.click(recap());
    await waitFor(async () => expect((await saved()).kinds.monthlyRecap.banner).toBe(false));
    expect(refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('sends a test banner from a small button at the bottom, and says where macOS allows banners', async () => {
    const user = userEvent.setup();
    const sendBanner = vi.fn().mockResolvedValue(undefined);
    useNotificationsStore.getState().configure({ sendBanner, now: () => new Date(2026, 10, 23, 12, 0) });
    await renderPane();
    const buttons = screen.getAllByRole('button');
    const test = screen.getByRole('button', { name: 'Send a test banner' });
    expect(buttons.at(-1)).toBe(test);
    await user.click(test);
    expect(sendBanner).toHaveBeenCalledWith('test', 'SlayBudget banners work', 'This is how alerts will look.');
    expect(await screen.findByText(/Didn’t see it\? Allow SlayBudget in System Settings > Notifications/)).toBeInTheDocument();
  });

  it('says when quiet hours are holding banners right now', async () => {
    useNotificationsStore.getState().configure({ sendBanner: vi.fn(), now: () => new Date(2026, 10, 23, 23, 30) });
    await renderPane();
    // Quiet hours are on by default, 22:00 to 08:00.
    expect(within(row('Quiet hours')).getByText('Quiet now: banners wait until 08:00.')).toBeInTheDocument();
  });

  describe('what macOS allows', () => {
    const withPermission = async (permission: string, extra: Record<string, unknown> = {}) => {
      useNotificationsStore.getState().configure({ sendBanner: vi.fn(), now: () => new Date(2026, 10, 23, 12, 0), permission: async () => permission, ...extra } as never);
      await renderPane();
      return permission === 'unknown' ? null : screen.findByRole('status', { name: 'macOS banners' });
    };

    it('says when macOS allows banners', async () => {
      expect(await withPermission('allowed')).toHaveTextContent('macOS shows SlayBudget’s banners.');
    });

    it('explains alerts that only reach Notification Center, with a way to fix it', async () => {
      const s = (await withPermission('quiet'))!;
      expect(s).toHaveTextContent('macOS only puts SlayBudget’s alerts in Notification Center. Set its alert style to Banners in System Settings > Notifications > SlayBudget.');
      expect(within(s).getByRole('button', { name: 'Open System Settings' })).toBeInTheDocument();
    });

    it('says when macOS blocks banners', async () => {
      const s = (await withPermission('denied'))!;
      expect(s).toHaveTextContent('macOS isn’t allowing SlayBudget’s notifications. Turn on Allow notifications in System Settings > Notifications > SlayBudget.');
      expect(within(s).getByRole('button', { name: 'Open System Settings' })).toBeInTheDocument();
    });

    it('asks macOS when it has not been asked yet', async () => {
      const user = userEvent.setup();
      const requestPermission = vi.fn().mockResolvedValue('allowed');
      const s = (await withPermission('notAsked', { requestPermission }))!;
      expect(s).toHaveTextContent('macOS hasn’t been asked to show SlayBudget’s banners yet.');
      await user.click(within(s).getByRole('button', { name: 'Allow banners' }));
      expect(requestPermission).toHaveBeenCalled();
      expect(await screen.findByRole('status', { name: 'macOS banners' })).toHaveTextContent('macOS shows SlayBudget’s banners.');
    });

    it('shows nothing when it cannot tell (the browser, or a development build)', async () => {
      await withPermission('unknown');
      await screen.findByRole('button', { name: 'Send a test banner' });
      expect(screen.queryByRole('status', { name: 'macOS banners' })).not.toBeInTheDocument();
    });
  });
});
