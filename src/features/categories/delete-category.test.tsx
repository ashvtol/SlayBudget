import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { CategoriesPage } from '@/features/analytics/categories-page';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { DeleteCategoryDialog } from './delete-category-dialog';

afterEach(() => cleanup());

const coffee: Category = { id: 11, groupId: 1, name: 'Coffee', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: 1, archived: false };

describe('DeleteCategoryDialog', () => {
  it('says how many transactions will move to Other', () => {
    const { rerender } = render(<DeleteCategoryDialog category={coffee} count={12} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Coffee?' });
    expect(within(dialog).getByText('Delete Coffee?')).toBeInTheDocument();
    expect(within(dialog).getByText("Its 12 transactions will move to Other. This can't be undone.")).toBeInTheDocument();
    rerender(<DeleteCategoryDialog category={coffee} count={1} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Its 1 transaction will move to Other.');
    rerender(<DeleteCategoryDialog category={coffee} count={0} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent("It has no transactions. This can't be undone.");
  });

  it('names Other by its current name', () => {
    render(<DeleteCategoryDialog category={coffee} count={2} otherName="Misc" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Its 2 transactions will move to Misc.');
  });

  it('Cancel closes without deleting', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteCategoryDialog category={coffee} count={3} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: null, color: '#e8743b', sortOrder: 0 },
  { id: 3, name: 'Other', emoji: null, color: '#8e8e93', sortOrder: 1 },
];
let nextId = 1;
const tx = (categoryId: number, amountCents: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn: '2026-11-03', description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});

describe('deleting from the Categories screen', () => {
  it('moves its transactions to Other, removes it, and shows All categories', async () => {
    setIpc(createMemoryIpc({
      groups: groups.map((g) => ({ ...g })),
      categories: [{ ...coffee }, { ...coffee, id: 10, name: 'Groceries', sortOrder: 0 }, { ...coffee, id: 99, groupId: 3, name: 'Other', sortOrder: 2 }],
      transactions: [tx(11, -500), tx(11, -700), tx(10, -2000), tx(99, -100)],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc(), 'deleteCategory');
    render(<CategoriesPage />);
    const tree = await screen.findByRole('grid', { name: 'Categories' });
    await user.click(within(tree).getByRole('row', { name: /Coffee/ }));
    await user.click(screen.getByRole('button', { name: 'Category actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete Coffee?' });
    expect(dialog).toHaveTextContent('Its 2 transactions will move to Other.');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(spy).toHaveBeenCalledWith(11);
    await waitFor(() => expect(within(tree).queryByRole('row', { name: /Coffee/ })).not.toBeInTheDocument());
    expect(within(tree).getByRole('row', { name: /Other/ })).toHaveTextContent('$13');
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'All categories' })).toBeInTheDocument();
  });
});

describe('a Transactions filter on a deleted category', () => {
  it('is dropped on the next load', async () => {
    setIpc(createMemoryIpc({
      groups: groups.map((g) => ({ ...g })),
      categories: [{ ...coffee }, { ...coffee, id: 99, groupId: 3, name: 'Other' }],
      transactions: [tx(11, -500)],
    }));
    useTransactionsStore.setState({ transactions: [], filter: {}, sort: 'newest', selected: new Set(), cursor: 0 });
    await useTransactionsStore.getState().load(null, { categoryIds: [11] });
    await ipc().deleteCategory(11);
    await useTransactionsStore.getState().applyFilter({});
    expect(useTransactionsStore.getState().filter.categoryIds ?? []).toEqual([]);
  });
});
