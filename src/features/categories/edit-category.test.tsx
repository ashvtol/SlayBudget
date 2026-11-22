import '@/test/echarts-mock';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, CategoryGroup } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { CategoriesPage } from '@/features/analytics/categories-page';
import { PALETTE } from './palette';

afterEach(() => cleanup());

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 0 },
  { id: 2, name: 'Transportation', emoji: '🚗', color: '#e8c34f', sortOrder: 1 },
  { id: 3, name: 'Other', emoji: '📦', color: '#8e8e93', sortOrder: 2 },
];
const cat = (id: number, groupId: number, name: string, emoji: string | null = null): Category => ({
  id, groupId, name, emoji, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});

beforeEach(async () => {
  setIpc(createMemoryIpc({
    groups: groups.map((g) => ({ ...g })),
    categories: [cat(10, 1, 'Groceries', '🥑'), cat(11, 1, 'Coffee'), cat(20, 2, 'Gas'), cat(30, 2, 'Parking'), cat(99, 3, 'Other', '📦')],
  }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21' });
  render(<CategoriesPage />);
  await screen.findByRole('region', { name: 'Budget summary' });
});

const tree = () => screen.getByRole('grid', { name: 'Categories' });
const details = () => screen.getByRole('region', { name: 'Details' });
const select = async (name: RegExp) => userEvent.click(within(tree()).getByRole('row', { name }));
const categoryNamed = async (name: string) => (await ipc().listCategories()).find((c) => c.name === name);
const groupOf = async (name: string) => {
  const c = (await categoryNamed(name))!;
  return (await ipc().listCategoryGroups()).find((g) => g.id === c.groupId)?.name;
};
const openMenu = async () => userEvent.click(screen.getByRole('button', { name: 'Category actions' }));

describe('editing a category', () => {
  it('renames in place: Enter saves, Escape cancels', async () => {
    const user = userEvent.setup();
    await select(/Coffee/);
    await user.click(within(details()).getByRole('button', { name: 'Rename Coffee' }));
    const input = within(details()).getByRole('textbox', { name: 'Category name' });
    await user.clear(input);
    await user.type(input, 'Cafes{Enter}');
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /Cafes/ })).toBeInTheDocument());
    await user.click(within(details()).getByRole('button', { name: 'Rename Cafes' }));
    await user.type(within(details()).getByRole('textbox', { name: 'Category name' }), 'xyz{Escape}');
    expect(within(details()).getByRole('heading', { name: 'Cafes' })).toBeInTheDocument();
  });

  it('refuses a duplicate name and keeps editing', async () => {
    const user = userEvent.setup();
    await select(/Coffee/);
    await user.click(within(details()).getByRole('button', { name: 'Rename Coffee' }));
    const input = within(details()).getByRole('textbox', { name: 'Category name' });
    await user.clear(input);
    await user.type(input, 'groceries{Enter}');
    expect(await within(details()).findByRole('alert')).toHaveTextContent(/already exists/);
    expect(within(details()).getByRole('textbox', { name: 'Category name' })).toBeInTheDocument();
  });

  it('changes the emoji', async () => {
    const user = userEvent.setup();
    await select(/Groceries/);
    await user.click(within(details()).getByRole('button', { name: /Choose emoji/ }));
    await user.click(screen.getByRole('button', { name: '🍕' }));
    await waitFor(async () => expect((await categoryNamed('Groceries'))?.emoji).toBe('🍕'));
  });

  it('moves to another group, a new group, or out of its group from the ⋯ menu', async () => {
    const user = userEvent.setup();
    await select(/Coffee/);
    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Group' }));
    await user.click(screen.getByRole('menuitem', { name: 'Transportation' }));
    await waitFor(async () => expect(await groupOf('Coffee')).toBe('Transportation'));

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Group' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start a new group…' }));
    await user.type(screen.getByRole('textbox', { name: 'New group name' }), 'Drinks{Enter}');
    await waitFor(async () => expect(await groupOf('Coffee')).toBe('Drinks'));

    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Group' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from group' }));
    await waitFor(async () => expect(await groupOf('Coffee')).toBe('Coffee'));
  });

  it('switches type to Excluded and changes color', async () => {
    const user = userEvent.setup();
    await select(/Gas/);
    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Type' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Excluded' }));
    await waitFor(() => expect(within(screen.getByRole('grid', { name: 'Excluded' })).getByRole('row', { name: /Gas/ })).toBeInTheDocument());
    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Color' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Color 9' }));
    await waitFor(async () => expect((await categoryNamed('Gas'))?.color).toBe(PALETTE[8]));
  });

  it('offers Delete for a normal category but never for Other, even renamed', async () => {
    const user = userEvent.setup();
    await select(/Coffee/);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Delete…' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await ipc().updateCategory(99, { name: 'Misc' });
    cleanup();
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    await select(/Misc/);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Delete…' })).not.toBeInTheDocument();
  });

  it('no longer has a separate Exclude button', async () => {
    await select(/Coffee/);
    expect(screen.queryByRole('button', { name: 'Exclude' })).not.toBeInTheDocument();
  });
});

describe('editing a group', () => {
  it('renames a group and ungroups it from its ⋯ menu', async () => {
    const user = userEvent.setup();
    await user.click(within(tree()).getByRole('row', { name: /Transportation/ }));
    await user.click(screen.getByRole('button', { name: 'Group actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename group' }));
    await user.type(screen.getByRole('textbox', { name: 'Group name' }), ' & Car{Enter}');
    await waitFor(async () => expect(await groupOf('Gas')).toBe('Transportation & Car'));
    await user.click(screen.getByRole('button', { name: 'Group actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup these categories' }));
    await waitFor(async () => expect(await groupOf('Gas')).toBe('Gas'));
    expect(await groupOf('Parking')).toBe('Parking');
  });
});

describe('group lists and selection', () => {
  it('Group › and the new-category form list only real groups, not top-level categories', async () => {
    const user = userEvent.setup();
    await ipc().moveCategoryToGroup(11, 'own'); // Coffee becomes top-level
    cleanup();
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    await select(/Gas/);
    await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Group' }));
    expect(screen.queryByRole('menuitem', { name: 'Coffee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Other' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Food & Drink' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    const options = within(screen.getByRole('combobox', { name: 'Group' })).getAllByRole('option').map((o) => o.textContent);
    expect(options).not.toContain('Coffee');
    expect(options).toContain('Food & Drink');
  });

  it('shows All categories after ungrouping the selected group', async () => {
    const user = userEvent.setup();
    await user.click(within(tree()).getByRole('row', { name: /Transportation/ }));
    await user.click(screen.getByRole('button', { name: 'Group actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ungroup these categories' }));
    await waitFor(() => expect(within(details()).getByRole('heading', { name: 'All categories' })).toBeInTheDocument());
  });
});
