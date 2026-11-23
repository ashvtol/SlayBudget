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

  it('has no test banner button', async () => {
    await renderPane();
    expect(screen.queryByRole('button', { name: /test banner/i })).toBeNull();
  });
});
