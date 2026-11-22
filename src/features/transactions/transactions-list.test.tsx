import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Transaction } from '@/lib/types';
import { TransactionsList } from './transactions-list';
import { useTransactionsStore } from './transactions-store';

// Render every row: jsdom has no layout, so the real virtualizer would show nothing.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44 })),
    measureElement: () => {},
  }),
}));

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'description' | 'amountCents'>): Transaction {
  return { profileId: 1, sourceId: 1, merchant: over.description.toLowerCase(), currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over };
}

const seed = {
  transactions: [
    tx({ id: 1, postedOn: '2026-11-15', description: 'WHOLE FOODS', amountCents: -6418, categoryId: 10 }),
    tx({ id: 2, postedOn: '2026-11-14', description: 'SHELL OIL', amountCents: -4800, categoryId: 20 }),
    tx({ id: 3, postedOn: '2026-10-05', description: 'PAYROLL', amountCents: 325000 }),
  ],
};

function noop() {}

afterEach(() => cleanup());

async function renderList(overrides: Partial<Parameters<typeof TransactionsList>[0]> = {}) {
  setIpc(createMemoryIpc(seed));
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, selected: new Set(), cursor: 0 });
  await useTransactionsStore.getState().load(null);
  render(<TransactionsList onOpen={noop} onPickCategory={noop} onFilters={noop} {...overrides} />);
}

describe('TransactionsList', () => {
  it('renders day headers, pills and amounts', async () => {
    await renderList();
    expect(await screen.findByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getAllByText(/Groceries/).length).toBeGreaterThan(0);
    const amounts = screen.getAllByTestId('amount').map((el) => el.textContent);
    expect(amounts).toContain('$64.18');
    expect(amounts).toContain('$3,250.00'); // income: green, no plus sign (Copilot)
    // one header per distinct day, Copilot wording
    expect(screen.getByText(/November 14|Today|Yesterday/)).toBeInTheDocument();
    expect(screen.getByText(/October 5/)).toBeInTheDocument();
  });

  it('shows an unreviewed marker that clears when reviewed via keyboard R', async () => {
    const user = userEvent.setup();
    await renderList();
    expect(screen.getAllByLabelText('Needs review').length).toBe(3);
    await user.keyboard('r'); // cursor starts on the first row
    await waitFor(() => expect(screen.getAllByLabelText('Needs review').length).toBe(2));
  });

  it('selects the cursor row with X', async () => {
    const user = userEvent.setup();
    await renderList();
    await user.keyboard('x');
    expect(useTransactionsStore.getState().selected.has(1)).toBe(true);
  });

  it('moves the cursor with arrows and reviews the right row', async () => {
    const user = userEvent.setup();
    await renderList();
    await user.keyboard('{ArrowDown}{ArrowDown}'); // to id 3
    await user.keyboard('r');
    await waitFor(() => expect(useTransactionsStore.getState().transactions.find((t) => t.id === 3)!.reviewed).toBe(true));
  });

  it('invokes the category picker on C and filters on F', async () => {
    const user = userEvent.setup();
    const onPickCategory = vi.fn();
    const onFilters = vi.fn();
    await renderList({ onPickCategory, onFilters });
    await user.keyboard('c');
    expect(onPickCategory).toHaveBeenCalledWith(1);
    await user.keyboard('f');
    expect(onFilters).toHaveBeenCalled();
  });

  it('shows an empty state with no transactions', async () => {
    setIpc(createMemoryIpc({ transactions: [] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, selected: new Set(), cursor: 0 });
    await useTransactionsStore.getState().load(null);
    render(<TransactionsList onOpen={noop} onPickCategory={noop} onFilters={noop} />);
    expect(screen.getByRole('status')).toHaveTextContent(/no transactions/i);
  });
});
