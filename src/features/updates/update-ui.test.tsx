import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useUpdateStore, type UpdaterDeps } from './update-store';
import { UpdateBadge, UpdateDialog } from './update-ui';
import { UpdatesPane } from '@/features/settings/updates-pane';

const NOTES = `## [0.3.0] - 2027-01-10\n### Added\n- **Goals** for saving\n- Faster import\n\n## [0.2.0] - 2026-12-01\n### Fixed\n- Readable pills\n\n## [0.1.0] - 2026-11-22\n- First\n`;
const install = vi.fn(async () => {});
const relaunch = vi.fn(async () => {});
const fake = (): UpdaterDeps => ({
  supported: () => true,
  currentVersion: async () => '0.1.0',
  check: async () => ({ version: '0.3.0', body: NOTES, date: '2027-01-10', downloadAndInstall: install }),
  relaunch,
});

afterEach(() => cleanup());
beforeEach(() => {
  setIpc(createMemoryIpc());
  useUpdateStore.getState().reset();
  useUpdateStore.getState().configure(fake());
});

describe('UpdateDialog', () => {
  it('shows both versions and every changelog section in between, then installs', async () => {
    const user = userEvent.setup();
    await useUpdateStore.getState().checkNow({ auto: true });
    render(<UpdateDialog />);
    const dialog = screen.getByRole('dialog', { name: 'Update available' });
    expect(dialog).toHaveTextContent('SlayBudget 0.3.0 is available');
    expect(dialog).toHaveTextContent('You have 0.1.0');
    expect(within(dialog).getByRole('heading', { name: /0\.3\.0/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /0\.2\.0/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /0\.1\.0/ })).toBeNull();
    expect(within(dialog).getByText('Goals', { selector: 'strong' })).toBeInTheDocument();
    expect(within(dialog).getByText('Readable pills')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Install and restart' }));
    await waitFor(() => expect(relaunch).toHaveBeenCalled());
  });

  it('Later closes it and leaves the sidebar badge, which reopens it', async () => {
    const user = userEvent.setup();
    await useUpdateStore.getState().checkNow({ auto: true });
    render(
      <>
        <UpdateBadge />
        <UpdateDialog />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog', { name: 'Update available' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Update available/ }));
    expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
  });

  it('no badge when up to date', async () => {
    useUpdateStore.getState().configure({ ...fake(), check: async () => null });
    await useUpdateStore.getState().checkNow();
    render(<UpdateBadge />);
    expect(screen.queryByRole('button', { name: /Update available/ })).toBeNull();
  });
});

describe('UpdatesPane', () => {
  it('shows the installed version, checks now, and offers the update with its changelog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <UpdatesPane />
        <UpdateDialog />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Check now' }));
    const pane = screen.getByRole('region', { name: 'Updates' });
    await waitFor(() => expect(pane).toHaveTextContent('Installed version 0.1.0'));
    expect(pane).toHaveTextContent('Version 0.3.0 is available');
    expect(pane).toHaveTextContent(/Last checked/);
    expect(screen.getByRole('dialog', { name: 'Update available' })).toBeInTheDocument();
  });
});
