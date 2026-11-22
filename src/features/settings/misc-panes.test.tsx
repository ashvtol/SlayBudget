import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { AboutPane } from './about-pane';
import { UpdatesPane } from './updates-pane';
import { ImportSourcesPane } from './import-sources-pane';

afterEach(() => cleanup());

describe('AboutPane', () => {
  it('shows the product name and version', () => {
    render(<AboutPane />);
    expect(screen.getByText('SlayBudget')).toBeInTheDocument();
    expect(screen.getByText(/^v\d/)).toBeInTheDocument();
  });
});

describe('UpdatesPane', () => {
  it('reports updates are unsupported outside the desktop app', async () => {
    const user = userEvent.setup();
    render(<UpdatesPane />);
    await user.click(screen.getByRole('button', { name: 'Check for updates' }));
    await waitFor(() => expect(screen.getByText(/installed desktop app/)).toBeInTheDocument());
  });
});

describe('ImportSourcesPane', () => {
  it('loads the watched-folder setting and notes the desktop requirement', async () => {
    setIpc(createMemoryIpc());
    await ipc().setSetting('watched_folder', '');
    render(<ImportSourcesPane />);
    await waitFor(() => expect(screen.getByLabelText('Watched folder path')).toBeInTheDocument());
    expect(screen.getByText(/Available in the installed app/)).toBeInTheDocument();
  });
});
