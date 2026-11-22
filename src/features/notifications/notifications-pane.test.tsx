import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useNotificationsStore } from './notifications-store';
import { NotificationsPane } from './notifications-pane';

afterEach(() => cleanup());

async function renderPane() {
  setIpc(createMemoryIpc());
  useNotificationsStore.setState({ enabled: false, horizonDays: 7, loaded: false });
  render(<NotificationsPane />);
  await waitFor(() => expect(useNotificationsStore.getState().loaded).toBe(true));
}

describe('NotificationsPane', () => {
  it('persists the enabled toggle and horizon', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByLabelText('Enable notifications'));
    await waitFor(() => expect(ipc().getSetting('notifications_enabled')).resolves.toBe('true'));
    await user.click(screen.getByRole('radio', { name: '14 days' }));
    await waitFor(() => expect(ipc().getSetting('reminder_horizon_days')).resolves.toBe('14'));
  });
});
