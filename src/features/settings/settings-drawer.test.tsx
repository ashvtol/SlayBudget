import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';
import { SettingsDrawer } from './settings-drawer';

afterEach(() => cleanup());
beforeEach(() => {
  setIpc(createMemoryIpc());
  useNavStore.setState({ section: 'dashboard', settingsOpen: true, settingsPane: null });
});

describe('SettingsDrawer', () => {
  it('groups settings into labelled sections of rows', () => {
    render(<SettingsDrawer />);
    const drawer = screen.getByRole('dialog', { name: 'Settings' });
    for (const group of ['Features', 'Appearance', 'General', 'Notifications', 'Data', 'App']) {
      expect(within(drawer).getByRole('group', { name: group })).toBeInTheDocument();
    }
    for (const row of ['Tags', 'Rollovers', 'Theme', 'Accessibility', 'Profiles', 'Currency', 'Import sources', 'Bank connections', 'Notifications and reminders', 'Data and backup', 'Updates', 'About']) {
      expect(within(drawer).getByRole('button', { name: new RegExp(`^${row}`) })).toBeInTheDocument();
    }
  });

  it('shows the current theme on its row', () => {
    render(<SettingsDrawer />);
    expect(screen.getByRole('button', { name: /^Theme.*Navy/ })).toBeInTheDocument();
  });

  it('opens a section and comes back', async () => {
    const user = userEvent.setup();
    render(<SettingsDrawer />);
    await user.click(screen.getByRole('button', { name: /^Profiles/ }));
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByRole('group', { name: 'General' })).toBeInTheDocument();
  });

  it('closes through the nav store', async () => {
    const user = userEvent.setup();
    render(<SettingsDrawer />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(useNavStore.getState().settingsOpen).toBe(false);
  });

  it('opens Tags from its row under Features', async () => {
    const user = userEvent.setup();
    render(<SettingsDrawer />);
    await user.click(screen.getByRole('button', { name: /^Tags/ }));
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New tag' })).toBeInTheDocument();
  });

  it('opens straight at a pane when asked (View tag settings)', () => {
    useNavStore.setState({ settingsOpen: true, settingsPane: 'tags' });
    render(<SettingsDrawer />);
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
  });
});
