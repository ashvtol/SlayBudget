import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Transaction } from '@/lib/types';
import { AccountsPane } from './accounts-pane';

const tx = (id: number, sourceId: number): Transaction => ({
  id, profileId: 1, sourceId, postedOn: '2026-11-03', description: `ROW ${id}`, merchant: 'row', amountCents: -100, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});

afterEach(() => cleanup());
beforeEach(() => {
  useProfileStore.setState({ profiles: [{ id: 1, name: 'Me', color: '#5b8cff', sortOrder: 0 }], activeProfileId: 1 });
  setIpc(
    createMemoryIpc({
      settings: { watched_folder: '/Users/me/Statements' },
      sources: [
        { id: 1, profileId: 1, name: 'Ink', kind: 'csv', institution: 'Chase', currency: 'USD', accountType: 'card' },
        { id: 2, profileId: 1, name: 'Checking', kind: 'pdf', institution: 'Citi', currency: 'USD', accountType: 'checking' },
      ],
      transactions: [tx(1, 1), tx(2, 1), tx(3, 2)],
      tags: [{ id: 9, name: 'Business', color: '#ddb24a' }],
      accountClues: [
        { id: 1, sourceId: 1, kind: 'last4', value: 'Chase|1004' },
        { id: 2, sourceId: 1, kind: 'layout', value: 'csv:amount|description|transaction date' },
      ],
    }),
  );
});

describe('AccountsPane', () => {
  it('lists accounts and edits one', async () => {
    const user = userEvent.setup();
    render(<AccountsPane />);
    const ink = await screen.findByRole('group', { name: 'Ink' });
    expect(within(ink).getByRole('radio', { name: 'Card' })).toBeChecked();
    const name = within(ink).getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Ink Business{Enter}');
    await waitFor(async () => expect((await ipc().listSources()).find((s) => s.id === 1)?.name).toBe('Ink Business'));
    await user.click(within(screen.getByRole('group', { name: 'Ink Business' })).getByRole('radio', { name: 'Checking' }));
    await waitFor(async () => expect((await ipc().listSources()).find((s) => s.id === 1)?.accountType).toBe('checking'));
  });

  it('a default tag can also go on what the account already has', async () => {
    const user = userEvent.setup();
    render(<AccountsPane />);
    const ink = await screen.findByRole('group', { name: 'Ink' });
    await user.selectOptions(within(ink).getByRole('combobox', { name: 'Default tag' }), 'Business');
    const also = within(ink).getByRole('checkbox', { name: 'Also tag the 2 transactions already in Ink' });
    await user.click(also);
    await user.click(within(ink).getByRole('button', { name: 'Save default tag' }));
    await waitFor(async () => expect((await ipc().listTransactions({})).filter((t) => t.tagIds?.includes(9)).map((t) => t.id).sort()).toEqual([1, 2]));
  });

  it('says what each account is recognized by, and forgets one', async () => {
    const user = userEvent.setup();
    render(<AccountsPane />);
    const ink = await screen.findByRole('group', { name: 'Ink' });
    const by = await within(ink).findByRole('list', { name: 'Recognized by' });
    expect(by).toHaveTextContent('Chase, ending 1004');
    expect(by).toHaveTextContent('CSV files with columns Amount, Description, Transaction date');
    await user.click(within(by).getByRole('button', { name: 'Forget Chase, ending 1004' }));
    await waitFor(() => expect(within(by).getAllByRole('listitem')).toHaveLength(1));
    expect(within(screen.getByRole('group', { name: 'Checking' })).getByText('Nothing yet: asked on its next import.')).toBeInTheDocument();
  });

  it('makes a folder for each account in the watched folder', async () => {
    const user = userEvent.setup();
    render(<AccountsPane />);
    await user.click(await screen.findByRole('button', { name: 'Create a folder for each account' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Made 2 folders in /Users/me/Statements');
  });
});
