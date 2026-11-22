import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Profile } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { ProfilesPane } from './profiles-pane';

afterEach(() => cleanup());

const freshProfiles = (): Profile[] => [{ id: 1, name: 'Alex', color: '#5b8cff', sortOrder: 0 }];

async function renderPane() {
  setIpc(createMemoryIpc({ profiles: freshProfiles() }));
  useProfileStore.setState({ profiles: [], activeProfileId: null });
  render(<ProfilesPane />);
  await waitFor(() => expect(screen.getByText('Alex')).toBeInTheDocument());
}

describe('ProfilesPane', () => {
  it('adds a profile', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.type(screen.getByLabelText('New profile name'), 'Jamie');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByText('Jamie')).toBeInTheDocument());
  });

  it('renames a profile', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Rename Alex');
    await user.clear(input);
    await user.type(input, 'Ash{Enter}');
    await waitFor(() => expect(screen.getByText('Ash')).toBeInTheDocument());
  });

  it('removes a profile', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Remove Alex' }));
    await waitFor(() => expect(screen.queryByText('Alex')).not.toBeInTheDocument());
  });
});
