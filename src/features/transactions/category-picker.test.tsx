import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Transaction } from '@/lib/types';
import { CategoryPicker } from './category-picker';
import { useTransactionsStore } from './transactions-store';

afterEach(() => cleanup());

function tx(id: number): Transaction {
  return { id, profileId: 1, sourceId: 1, postedOn: '2026-11-14', description: 'NETFLIX', merchant: 'netflix', amountCents: -1799, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null };
}

async function renderPicker(onClose = () => {}) {
  setIpc(createMemoryIpc({ transactions: [tx(1)] }));
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0 });
  await useTransactionsStore.getState().load(null);
  render(<CategoryPicker transactionId={1} onClose={onClose} />);
  await screen.findByText('Groceries');
}

describe('CategoryPicker', () => {
  it('lists categories and assigns one, marking the row reviewed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderPicker(onClose);
    await user.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => {
      const t = useTransactionsStore.getState().byId(1)!;
      expect(t.categoryId).toBe(10);
      expect(t.reviewed).toBe(true);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('filters by search query', async () => {
    const user = userEvent.setup();
    await renderPicker();
    await user.type(screen.getByLabelText('Search categories'), 'fuel');
    expect(screen.getByRole('button', { name: /Fuel/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
  });

  it('offers to create a category for an unknown name and assigns it', async () => {
    const user = userEvent.setup();
    await renderPicker();
    await user.type(screen.getByLabelText('Search categories'), 'Daycare');
    await user.click(screen.getByRole('button', { name: /Create .Daycare/ }));
    await waitFor(() => {
      const t = useTransactionsStore.getState().byId(1)!;
      expect(t.categoryId).not.toBeNull();
      expect(useTransactionsStore.getState().categoriesById[t.categoryId!].name).toBe('Daycare');
    });
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderPicker(onClose);
    await user.type(screen.getByLabelText('Search categories'), '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking outside it, without changing the category', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderPicker(onClose);
    await user.click(document.body);
    expect(onClose).toHaveBeenCalled();
    expect(useTransactionsStore.getState().byId(1)?.categoryId).toBeNull();
  });

  it('stays open when clicking inside it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderPicker(onClose);
    await user.click(screen.getByLabelText('Search categories'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape even when the search field is not focused', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    await renderPicker(onClose);
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

