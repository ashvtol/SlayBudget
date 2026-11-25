import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { historyArea } from '@/features/charts/svg/budget-history-chart';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, setIpc, ipc } from '@/lib/ipc';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';
import { CategoriesPage } from './categories-page';
import { useNavStore } from '@/lib/stores/nav-store';

afterEach(() => cleanup());

const groups: CategoryGroup[] = [
  { id: 1, name: 'Home', emoji: '🏠', color: '#4c85ee', sortOrder: 0 },
  { id: 2, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 1 },
];
const cat = (id: number, groupId: number, name: string, budgetCents: number | null): Category => ({
  id, groupId, name, emoji: null, color: null, budgetCents, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});

async function setup() {
  setIpc(createMemoryIpc({
    groups,
    categories: [cat(10, 1, 'Rent', 220000), cat(20, 2, 'Groceries', 30000), cat(21, 2, 'Restaurants', 20000)],
    transactions: [tx('2026-11-01', -220000, 10), tx('2026-11-03', -12000, 20), tx('2026-11-04', -4000, 21)],
  }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21' });
  render(<CategoriesPage />);
  await screen.findByRole('region', { name: 'Budget summary' });
}

const tree = () => screen.getByRole('grid', { name: 'Categories' });
const details = () => screen.getByRole('region', { name: 'Details' });

describe('CategoriesPage', () => {
  it('summarises spent this month against the total budget', async () => {
    await setup();
    const summary = screen.getByRole('region', { name: 'Budget summary' });
    expect(summary).toHaveTextContent('$2,360spent in Nov');
    expect(summary).toHaveTextContent('$2,700total budget');
    expect(within(summary).getByRole('img', { name: 'Spent vs budget' })).toBeInTheDocument();
  });

  it('shows groups and categories with spent and budget', async () => {
    await setup();
    expect(within(tree()).getByRole('row', { name: /Food & Drink/ })).toHaveTextContent('$160');
    expect(within(tree()).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$120');
    expect(within(tree()).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$300');
  });

  it('details all categories by default with history, metrics and a budget table', async () => {
    await setup();
    expect(within(details()).getByRole('heading', { name: 'All categories' })).toBeInTheDocument();
    expect(details()).toHaveTextContent('$340 left');
    expect(within(details()).getByRole('img', { name: 'Budget history' })).toBeInTheDocument();
    expect(within(details()).getByRole('table', { name: 'Key metrics' })).toHaveTextContent('2026');
    expect(within(details()).getByRole('table', { name: 'Category budgets' })).toHaveTextContent('Restaurants');
  });

  it('selects a category from the tree', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(tree()).getByRole('row', { name: /Groceries/ }));
    expect(within(details()).getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(details()).toHaveTextContent('$180 left');
  });

  it('edits a budget', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    const input = within(details()).getByRole('textbox', { name: 'Budget for Groceries' });
    await user.clear(input);
    await user.type(input, '400{Enter}');
    await waitFor(async () => expect((await ipc().listCategories()).find((c) => c.id === 20)?.budgetCents).toBe(40000));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget summary' })).toHaveTextContent('$2,800total budget'));
  });

  it('excludes the selected category', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(tree()).getByRole('row', { name: /Restaurants/ }));
    await user.click(screen.getByRole('button', { name: 'Category actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Type' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Excluded' }));
    await waitFor(() => expect(within(screen.getByRole('grid', { name: 'Excluded' })).getByRole('row', { name: /Restaurants/ })).toBeInTheDocument());
    expect(within(tree()).queryByRole('row', { name: /Restaurants/ })).not.toBeInTheDocument();
  });

  it('collapses a group', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(tree()).getByRole('button', { name: 'Collapse Food & Drink' }));
    expect(within(tree()).queryByRole('row', { name: /Groceries/ })).not.toBeInTheDocument();
  });

  it('clears a budget when the amount is emptied', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    await user.clear(within(details()).getByRole('textbox', { name: 'Budget for Restaurants' }));
    await user.keyboard('{Enter}');
    await waitFor(async () => expect((await ipc().listCategories()).find((c) => c.id === 21)?.budgetCents).toBeNull());
  });

  it('adds a category from the + menu and selects it', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: /Pets/ }));
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /Pets/ })).toBeInTheDocument());
    expect(within(details()).getByRole('heading', { name: 'Pets' })).toBeInTheDocument();
  });

  it('cleans up Other from its detail', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({
      groups: [...groups, { id: 3, name: 'Other', emoji: null, color: '#888888', sortOrder: 2 }],
      categories: [cat(10, 1, 'Rent', 220000), cat(20, 2, 'Groceries', 30000), cat(30, 3, 'Other', null)],
      transactions: [tx('2026-11-01', -4000, 30), tx('2026-11-02', -5000, 30)],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    await user.click(within(tree()).getByRole('row', { name: /Other/ }));
    await user.click(screen.getByRole('button', { name: 'Clean up' }));
    const region = await screen.findByRole('region', { name: 'Clean up Other' });
    await waitFor(() => expect(region).toHaveTextContent('2 left in Other'));
  });

  it('opens Clean up Other when asked from elsewhere', async () => {
    useNavStore.setState({ cleanUpOther: true });
    setIpc(createMemoryIpc({
      groups: [...groups, { id: 3, name: 'Other', emoji: null, color: '#888888', sortOrder: 2 }],
      categories: [cat(10, 1, 'Rent', 220000), cat(30, 3, 'Other', null)],
      transactions: [tx('2026-11-01', -4000, 30)],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    expect(await screen.findByRole('region', { name: 'Clean up Other' })).toBeInTheDocument();
    expect(useNavStore.getState().cleanUpOther).toBe(false);
  });

  it('opens Clean up Other when asked again after the screen was already open', async () => {
    useNavStore.setState({ cleanUpOther: false });
    setIpc(createMemoryIpc({
      groups: [...groups, { id: 3, name: 'Other', emoji: null, color: '#888888', sortOrder: 2 }],
      categories: [cat(10, 1, 'Rent', 220000), cat(30, 3, 'Other', null)],
      transactions: [tx('2026-11-01', -4000, 30)],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    expect(screen.queryByRole('region', { name: 'Clean up Other' })).not.toBeInTheDocument();
    act(() => useNavStore.getState().openCleanUpOther());
    expect(await screen.findByRole('region', { name: 'Clean up Other' })).toBeInTheDocument();
    expect(useNavStore.getState().cleanUpOther).toBe(false);
  });

  it('opens Clean up Other when asked while Clean up was left on and another category is selected', async () => {
    const user = userEvent.setup();
    useNavStore.setState({ cleanUpOther: true });
    setIpc(createMemoryIpc({
      groups: [...groups, { id: 3, name: 'Other', emoji: null, color: '#888888', sortOrder: 2 }],
      categories: [cat(10, 1, 'Rent', 220000), cat(30, 3, 'Other', null)],
      transactions: [tx('2026-11-01', -4000, 30)],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Clean up Other' });
    // Moved to another category (as after creating one) without turning Clean up off.
    await user.click(within(tree()).getByRole('row', { name: /Rent/ }));
    expect(screen.queryByRole('region', { name: 'Clean up Other' })).not.toBeInTheDocument();
    act(() => useNavStore.getState().openCleanUpOther());
    expect(await screen.findByRole('region', { name: 'Clean up Other' })).toBeInTheDocument();
    expect(useNavStore.getState().cleanUpOther).toBe(false);
  });

  it('with no Other category, a later ask goes back to All to show Clean up', async () => {
    const user = userEvent.setup();
    useNavStore.setState({ cleanUpOther: true });
    setIpc(createMemoryIpc({ groups, categories: [cat(10, 1, 'Rent', 220000)], transactions: [tx('2026-11-01', -4000, null as unknown as number)] }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Clean up Other' });
    await user.click(within(tree()).getByRole('row', { name: /Rent/ }));
    expect(screen.queryByRole('region', { name: 'Clean up Other' })).not.toBeInTheDocument();
    act(() => useNavStore.getState().openCleanUpOther());
    expect(await screen.findByRole('region', { name: 'Clean up Other' })).toBeInTheDocument();
  });

  it('opens Clean up Other for uncategorized rows when there is no Other category', async () => {
    useNavStore.setState({ cleanUpOther: true });
    setIpc(createMemoryIpc({ groups, categories: [cat(10, 1, 'Rent', 220000)], transactions: [tx('2026-11-01', -4000, null as unknown as number)] }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    const region = await screen.findByRole('region', { name: 'Clean up Other' });
    await waitFor(() => expect(region).toHaveTextContent('1 left in Other'));
  });
});

describe('CategoriesPage income', () => {
  it('lists income categories in their own section with this month\'s income and no budget', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({
      groups: [...groups, { id: 5, name: 'Income', emoji: null, color: '#57bd57', sortOrder: 5 }],
      categories: [cat(10, 1, 'Rent', 220000), { ...cat(50, 5, 'Salary', null), kind: 'income' }],
      transactions: [tx('2026-11-01', -220000, 10), { ...tx('2026-11-05', 500000, 50), txType: 'income' }],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    const income = await screen.findByRole('grid', { name: 'Income' });
    expect(within(income).getByRole('row', { name: /Salary/ })).toHaveTextContent('$5,000');
    expect(within(screen.getByRole('grid', { name: 'Categories' })).queryByRole('row', { name: /Salary/ })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Budget summary' })).toHaveTextContent('$2,200spent in Nov');
    await user.click(within(income).getByRole('row', { name: /Salary/ }));
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'Salary' })).toBeInTheDocument();
  });
});

describe('CategoriesPage expected bills', () => {
  it('outlines bills still due this month in their category', async () => {
    setIpc(createMemoryIpc({
      groups,
      categories: [cat(10, 1, 'Rent', 220000), cat(20, 2, 'Groceries', 30000), cat(21, 2, 'Restaurants', 20000)],
      transactions: [tx('2026-08-25', -4000, 21), tx('2026-09-25', -4000, 21), tx('2026-10-25', -4000, 21)].map((t) => ({ ...t, merchant: 'supper club', description: 'SUPPER CLUB' })),
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    const row = await within(await screen.findByRole('grid', { name: 'Categories' })).findByRole('row', { name: /Restaurants/ });
    expect(await within(row).findByLabelText('Expected $40')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Budget summary' })).toHaveTextContent('$40 expected');
  });
});

describe('CategoriesPage budgets (Copilot)', () => {
  async function setupWith(over: { settings?: Record<string, string>; before?: () => Promise<void> } = {}) {
    setIpc(createMemoryIpc({
      groups,
      settings: over.settings,
      categories: [cat(10, 1, 'Rent', 220000), cat(20, 2, 'Groceries', 30000), cat(21, 2, 'Restaurants', 20000)],
      transactions: [
        tx('2026-11-01', -220000, 10), tx('2026-11-03', -12000, 20), tx('2026-11-04', -24000, 21),
        tx('2026-10-04', -35000, 21), tx('2026-09-04', -35000, 21), tx('2026-08-04', -35000, 21),
        tx('2026-10-03', -10000, 20), tx('2026-09-03', -10000, 20), tx('2026-08-03', -10000, 20),
      ],
    }));
    await over.before?.();
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
  }
  const selectRow = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => user.click(within(tree()).getByRole('row', { name }));

  it('Save budget is a macOS primary button, readable in every theme (text in the accent\'s own ink, not white)', async () => {
    const user = userEvent.setup();
    await setupWith();
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    const save = within(details()).getByRole('button', { name: 'Save budget' });
    expect(save).toHaveClass('btn', 'btn-primary');
    expect(save).toBeEnabled();
  });

  it('sets a different budget for one month, which shows in the tree for that month only', async () => {
    const user = userEvent.setup();
    await setupWith();
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    await user.selectOptions(within(details()).getByRole('combobox', { name: 'Budget period' }), 'Different budgets per month');
    expect(within(details()).getByRole('combobox', { name: 'Month' })).toHaveDisplayValue('November 2026');
    const amount = within(details()).getByRole('textbox', { name: 'Budget amount' });
    await user.clear(amount);
    await user.type(amount, '450');
    await user.click(within(details()).getByRole('button', { name: 'Save budget' }));
    await waitFor(async () => expect((await ipc().getBudgetPlan()).months).toEqual([{ categoryId: 20, month: '2026-11', amountCents: 45000 }]));
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$450'));
    expect((await ipc().listCategories()).find((c) => c.id === 20)?.budgetCents).toBe(30000);
  });

  it('saving the same budget for all months replaces the per-month ones', async () => {
    const user = userEvent.setup();
    await setupWith({ before: () => ipc().setBudget(20, '2026-12', 1000) });
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    expect(within(details()).getByRole('combobox', { name: 'Budget period' })).toHaveDisplayValue('Different budgets per month');
    await user.selectOptions(within(details()).getByRole('combobox', { name: 'Budget period' }), 'Same budget for all months');
    const amount = within(details()).getByRole('textbox', { name: 'Budget amount' });
    await user.clear(amount);
    await user.type(amount, '350');
    await user.click(within(details()).getByRole('button', { name: 'Save budget' }));
    await waitFor(async () => expect((await ipc().getBudgetPlan()).months).toEqual([]));
    expect((await ipc().listCategories()).find((c) => c.id === 20)?.budgetCents).toBe(35000);
  });

  it('gives a group one shared budget; its categories then have none of their own', async () => {
    const user = userEvent.setup();
    await setupWith();
    await selectRow(user, /Food & Drink/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    const amount = within(details()).getByRole('textbox', { name: 'Shared budget for Food & Drink' });
    await user.type(amount, '600');
    await user.click(within(details()).getByRole('button', { name: 'Save budget' }));
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /Food & Drink/ })).toHaveTextContent('$600'));
    expect(within(tree()).getByRole('row', { name: /Groceries/ })).not.toHaveTextContent('$300');
    await waitFor(() => expect(screen.getByRole('region', { name: 'Budget summary' })).toHaveTextContent('$2,800total budget'));
  });

  it('offers rollover only when rollovers are on, and shows what carried over', async () => {
    const user = userEvent.setup();
    await setupWith({ settings: { 'budgets.rollovers': '1' } });
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    await user.click(within(details()).getByRole('checkbox', { name: 'Roll over unspent budget' }));
    await user.click(within(details()).getByRole('button', { name: 'Save budget' }));
    await waitFor(async () => expect((await ipc().getBudgetPlan()).rollovers).toEqual([{ categoryId: 20, since: '2026-11' }]));
  });

  it('shows what carried over and counts it in what is left', async () => {
    const user = userEvent.setup();
    // Rolling over since October: 300 budget - 100 spent = +200 into November.
    await setupWith({ settings: { 'budgets.rollovers': '1' }, before: () => ipc().setRollover(20, '2026-10') });
    await selectRow(user, /Groceries/);
    expect(details()).toHaveTextContent('Rollover +$200');
    expect(details()).toHaveTextContent('$380 left');
  });

  it('does not offer rollover while rollovers are off', async () => {
    const user = userEvent.setup();
    await setupWith();
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    expect(within(details()).queryByRole('checkbox', { name: 'Roll over unspent budget' })).not.toBeInTheDocument();
  });

  it('rebalances toward where money is going, for this month only', async () => {
    const user = userEvent.setup();
    await setupWith();
    await user.click(screen.getByRole('button', { name: 'Rebalance' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview budget changes' });
    expect(dialog).toHaveTextContent('without changing your total budget amount');
    // Restaurants usually spends 350 against 200; Groceries usually 100 against 300.
    expect(within(dialog).getByRole('row', { name: /Restaurants/ })).toHaveTextContent('+$150');
    expect(within(dialog).getByRole('row', { name: /Groceries/ })).toHaveTextContent('-$150');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await ipc().getBudgetPlan()).months).toEqual([
        { categoryId: 20, month: '2026-11', amountCents: 15000 },
        { categoryId: 21, month: '2026-11', amountCents: 35000 },
      ]),
    );
    expect(screen.queryByRole('dialog', { name: 'Preview budget changes' })).not.toBeInTheDocument();
  });

  it('rebalances from now on as new defaults', async () => {
    const user = userEvent.setup();
    await setupWith();
    await user.click(screen.getByRole('button', { name: 'Rebalance' }));
    const dialog = screen.getByRole('dialog', { name: 'Preview budget changes' });
    await user.click(within(dialog).getByRole('radio', { name: 'From now on' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await ipc().listCategories()).find((c) => c.id === 21)?.budgetCents).toBe(35000));
    expect((await ipc().getBudgetPlan()).months).toEqual([]);
  });

  it('says so when budgets already match spending', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({ groups, categories: [cat(20, 2, 'Groceries', 30000), cat(21, 2, 'Restaurants', 20000)], transactions: [] }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    await user.click(screen.getByRole('button', { name: 'Rebalance' }));
    expect(screen.getByRole('dialog', { name: 'Preview budget changes' })).toHaveTextContent('Your budgets already match your spending.');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps table inputs from overwriting per-month budgets or shared group members', async () => {
    const user = userEvent.setup();
    await setupWith({
      before: async () => {
        await ipc().setBudget(20, '2026-12', 1000);
        await ipc().setGroupBudget(1, 250000);
      },
    });
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    expect(within(details()).getByRole('textbox', { name: 'Budget for Groceries' })).toBeDisabled();
    expect(within(details()).queryByRole('textbox', { name: 'Budget for Rent' })).not.toBeInTheDocument();
    expect(within(details()).getByRole('textbox', { name: 'Budget for Restaurants' })).toBeEnabled();
  });

  it('edits a selected category in one place: the header editor, not its table row too', async () => {
    const user = userEvent.setup();
    await setupWith();
    await selectRow(user, /Groceries/);
    await user.click(screen.getByRole('button', { name: 'Edit budget' }));
    expect(within(details()).getByRole('textbox', { name: 'Budget amount' })).toBeInTheDocument();
    expect(within(details()).queryByRole('textbox', { name: 'Budget for Groceries' })).not.toBeInTheDocument();
  });

  it('offers Rebalance only once two categories have budgets', async () => {
    setIpc(createMemoryIpc({ groups, categories: [cat(20, 2, 'Groceries', 30000), cat(21, 2, 'Restaurants', null)], transactions: [] }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CategoriesPage />);
    await screen.findByRole('region', { name: 'Budget summary' });
    expect(screen.getByRole('button', { name: 'Rebalance' })).toBeDisabled();
  });
});

describe('CategoriesPage month picked on the history chart', () => {
  it('hovering a month shows its spending in the header without picking it', async () => {
    await setup();
    const chart = within(details()).getByRole('img', { name: 'Budget history' });
    const area = historyArea(560, 120);
    const spentIn = () => within(details()).getByText(/^Spent in/).textContent;
    fireEvent.pointerMove(chart, { clientX: area.left + (area.width / 24) * 22.5 });
    expect(spentIn()).toBe('Spent in October 2026');
    fireEvent.pointerLeave(chart);
    expect(spentIn()).toBe('Spent in Nov');
  });

  it('clicking a month bar shows that month in the detail, and Back returns to this month', async () => {
    const user = userEvent.setup();
    await setup();
    const chart = within(details()).getByRole('img', { name: 'Budget history' });
    const area = historyArea(560, 120);
    // 24 months ending Nov 2026: index 22 is October.
    fireEvent.click(chart, { clientX: area.left + (area.width / 24) * 22.5 });
    const spentIn = () => within(details()).getByText(/^Spent in/).textContent;
    expect(spentIn()).toBe('Spent in October 2026');
    expect(within(details()).getByRole('table', { name: 'Category budgets' })).toHaveTextContent('Groceries');
    await user.click(within(details()).getByRole('button', { name: 'Back to this month' }));
    expect(spentIn()).toBe('Spent in Nov');
    expect(within(details()).queryByRole('button', { name: 'Back to this month' })).toBeNull();
  });
});

describe("CategoriesPage a category's transactions", () => {
  it('lists the selected category transactions by month, and opens one in Transactions', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(tree()).getByRole('row', { name: /Groceries/ }));
    const list = within(details()).getByRole('grid', { name: 'Groceries transactions' });
    expect(within(list).getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
    expect(within(list).getAllByRole('row')).toHaveLength(1);
    expect(within(list).getByRole("row")).toHaveTextContent("Nov 3");
    expect(within(list).getByRole("row")).toHaveTextContent("$120.00");
    expect(within(details()).queryByRole('table', { name: 'Category budgets' })).toBeNull();
  });
});

describe('CategoriesPage transaction drawer', () => {
  it('opens a clicked transaction in a side pane to edit it, without leaving Categories', async () => {
    const user = userEvent.setup();
    useNavStore.setState({ section: 'categories' });
    await setup();
    await user.click(within(tree()).getByRole('row', { name: /Groceries/ }));
    const list = within(details()).getByRole('grid', { name: 'Groceries transactions' });
    await user.click(within(list).getByRole('row'));
    const drawer = await screen.findByRole('dialog', { name: 'Transaction' });
    expect(await within(drawer).findByRole('article', { name: 'Transaction detail' })).toBeInTheDocument();
    expect(within(drawer).getByRole('textbox', { name: /notes/i })).toBeInTheDocument();
    expect(useNavStore.getState().section).toBe('categories');
    // Recategorize from the pane: the category page reflects it.
    await user.click(within(drawer).getByRole('button', { name: /Groceries/i }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Choose category' })).getByRole('button', { name: /Restaurants/ }));
    await waitFor(() => expect(within(tree()).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$0'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Transaction' })).toBeNull());
  });
});

describe('CategoriesPage opened from a notification', () => {
  it('selects the category and the month the notification is about', async () => {
    await setup();
    await act(async () => useNavStore.getState().openIntent({ kind: 'category', id: 20, month: '2026-10' }));
    await waitFor(() => expect(within(details()).getByText('Spent in October 2026')).toBeInTheDocument());
    expect(within(details()).getByRole('heading', { name: 'Groceries' })).toBeInTheDocument();
    expect(useNavStore.getState().intent).toBeNull();
  });

  it('a recap for All categories shows that month for everything', async () => {
    await setup();
    await act(async () => useNavStore.getState().openIntent({ kind: 'category', id: null, month: '2026-10' }));
    await waitFor(() => expect(within(details()).getByRole('heading', { name: 'All categories' })).toBeInTheDocument());
    expect(details()).toHaveTextContent('Spent in October 2026');
  });
});
