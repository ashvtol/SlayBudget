import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { useSearchStore } from './search-store';
import { SearchPalette } from './search-palette';

afterEach(() => cleanup());

const sources: Source[] = [{ id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: null, currency: 'USD' }];
const transactions: Transaction[] = [
  { id: 1, profileId: 1, sourceId: 1, postedOn: '2026-10-04', description: 'STARBUCKS', merchant: 'starbucks', amountCents: -650, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null },
  { id: 2, profileId: 1, sourceId: 1, postedOn: '2026-11-01', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -5000, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null },
];

async function setup() {
  setIpc(createMemoryIpc({ sources, transactions }));
  useProfileStore.setState({ activeProfileId: null });
  useSearchStore.setState({ open: true, query: '', results: [], loading: false });
  await useTransactionsStore.getState().load(null);
  render(<SearchPalette />);
}

describe('SearchPalette', () => {
  it('searches as you type and navigates on pick', async () => {
    const user = userEvent.setup();
    await setup();
    await user.type(screen.getByLabelText('Search query'), 'starb');
    await waitFor(() => expect(screen.getByText('STARBUCKS')).toBeInTheDocument());
    expect(screen.queryByText('WHOLE FOODS')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(useNavStore.getState().section).toBe('transactions');
      expect(useSearchStore.getState().open).toBe(false);
    });
  });

  it('shows the category of each result even before the Transactions screen was opened', async () => {
    const user = userEvent.setup();
    const coffee = { id: 5, groupId: 1, name: 'Coffee', emoji: null, color: '#884422', budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 0, archived: false };
    setIpc(createMemoryIpc({ sources, categories: [coffee], transactions: [{ ...transactions[0], categoryId: 5 }] }));
    useProfileStore.setState({ activeProfileId: null });
    useSearchStore.setState({ open: true, query: '', results: [], loading: false });
    useTransactionsStore.setState({ categoriesById: {} });
    render(<SearchPalette />);
    await user.type(screen.getByLabelText('Search query'), 'starb');
    await waitFor(() => expect(screen.getByText('STARBUCKS')).toBeInTheDocument());
    expect(await screen.findByText('Coffee')).toBeInTheDocument();
    expect(screen.queryByText('Needs category')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    await setup();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(useSearchStore.getState().open).toBe(false));
  });
});
