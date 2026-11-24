import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { InsightsPage } from '@/features/analytics/insights-page';
import { useHabitsStore } from './habits-store';
import { useUndoStore } from '@/features/undo/undo-store';

afterEach(() => cleanup());

const groups: CategoryGroup[] = [{ id: 1, name: 'Everything', emoji: null, color: '#888888', sortOrder: 0 }];
const cat = (id: number, name: string, extra: Partial<Category> = {}): Category => ({
  id, groupId: 1, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, ...extra,
});
const categories = [cat(1, 'Rent'), cat(2, 'Restaurants'), cat(3, 'Shopping'), cat(4, 'Salary', { kind: 'income' })];
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number, txType: Transaction['txType'] = 'regular', merchant = 'm'): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

// Nov 2025 to Nov 2026: $6,200 in, $2,900 rent, $1,000 restaurants, $800 shopping (24% saved).
function history(): Transaction[] {
  const out: Transaction[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 7);
    out.push(tx(`${d}-01`, 620000, 4, 'income', 'payroll'), tx(`${d}-02`, -290000, 1, 'regular', 'landlord'), tx(`${d}-05`, -100000, 2), tx(`${d}-06`, -80000, 3));
  }
  return out;
}

beforeEach(() => {
  setIpc(createMemoryIpc({ groups, categories: categories.map((c) => ({ ...c })), transactions: history() }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21', range: 'threeMonths' });
  useHabitsStore.setState(useHabitsStore.getInitialState());
});

const habits = () => screen.findByRole('region', { name: 'Your money habits' });
const styleCard = () => screen.getByRole('region', { name: 'Your money style' });
const budgetCard = () => screen.getByRole('region', { name: 'Suggested budget' });

describe('Your money habits on Insights', () => {
  it('comes after Where your money went, saying it uses all of history', async () => {
    render(<InsightsPage />);
    const section = await habits();
    const map = screen.getByRole('region', { name: 'Where your money went' });
    expect(map.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section).toHaveTextContent("Based on all your history, Nov 2025 to Nov 2026. The time range at the top doesn't change this section.");
  });

  it('shows the savings rate and FIRE figures, which the time range does not change', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(styleCard()).toHaveTextContent('24%'));
    expect(styleCard()).toHaveTextContent('Your FI number');
    expect(styleCard()).toHaveTextContent('$1,410,000');
    expect(styleCard()).toHaveTextContent('about 33');
    await user.click(screen.getByRole('radio', { name: '1W' }));
    await waitFor(() => expect(useAnalyticsStore.getState().range).toBe('week'));
    expect(styleCard()).toHaveTextContent('24%');
    expect(styleCard()).toHaveTextContent('$1,410,000');
  });

  it('says plainly when more was spent than came in', async () => {
    const rows = history().map((t) => (t.merchant === 'landlord' ? { ...t, amountCents: -500000 } : t));
    setIpc(createMemoryIpc({ groups, categories: categories.map((c) => ({ ...c })), transactions: rows }));
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(styleCard()).toHaveTextContent('-10%'));
    expect(styleCard()).toHaveTextContent('$600 more spent than came in, a month, last 12 months');
  });

  it('shows the 10 biggest categories, with the rest behind Show all', async () => {
    const many = Array.from({ length: 14 }, (_, i) => cat(20 + i, `Cat ${i + 1}`));
    const rows = history().concat(
      many.flatMap((c, i) => Array.from({ length: 13 }, (_, m) => tx(`${new Date(Date.UTC(2025, 10 + m, 1)).toISOString().slice(0, 7)}-09`, -(5000 + i * 100), c.id))),
    );
    setIpc(createMemoryIpc({ groups, categories: [...categories, ...many].map((c) => ({ ...c })), transactions: rows }));
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(within(budgetCard()).getAllByRole('checkbox', { name: /in the budget/ })).toHaveLength(10));
    await user.click(within(budgetCard()).getByRole('button', { name: 'Show all 16' }));
    expect(within(budgetCard()).getAllByRole('checkbox', { name: /in the budget/ })).toHaveLength(16);
    await user.click(within(budgetCard()).getByRole('button', { name: 'Show fewer' }));
    expect(within(budgetCard()).getAllByRole('checkbox', { name: /in the budget/ })).toHaveLength(10);
  });

  it('switches to Soft saving, remembers it, and explains both styles', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await user.click(within(styleCard()).getByRole('radio', { name: 'Soft saving' }));
    await waitFor(() => expect(styleCard()).toHaveTextContent('Saving for later'));
    expect(await ipc().getSetting('money_style')).toBe('soft');
    await user.click(within(styleCard()).getByRole('button', { name: 'About the two styles' }));
    const help = screen.getByRole('dialog', { name: 'About the two styles' });
    expect(help).toHaveTextContent('FIRE: Financial Independence, Retire Early');
    expect(help).toHaveTextContent('not financial advice');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'About the two styles' })).not.toBeInTheDocument();
  });

  it('suggests a budget for the target, which − and + change', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    expect(budgetCard()).toHaveTextContent('Spend about $4,030 a month');
    expect(within(budgetCard()).getByRole('row', { name: /Restaurants/ })).toHaveTextContent(/\$1,000.*\$630/);
    await user.click(within(budgetCard()).getByRole('button', { name: 'Raise target' }));
    expect(budgetCard()).toHaveTextContent('40%');
    expect(budgetCard()).toHaveTextContent('Spend about $3,720 a month');
    expect(await ipc().getSetting('habits_target_fire')).toBe('40');
  });

  it('Adjust lets you change an amount, and Use these budgets sets them in one undoable step', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    await user.click(within(budgetCard()).getByRole('button', { name: 'Adjust' }));
    const field = within(budgetCard()).getByRole('textbox', { name: 'Suggested budget for Restaurants' });
    await user.clear(field);
    await user.type(field, '600');
    await user.click(within(budgetCard()).getByRole('button', { name: 'Use these budgets' }));
    await waitFor(() => expect(within(budgetCard()).getByRole('status')).toHaveTextContent('Budgets set for 2 categories'));
    const after = await ipc().listCategories();
    expect(after.find((c) => c.name === 'Restaurants')!.budgetCents).toBe(60000);
    expect(after.find((c) => c.name === 'Shopping')!.budgetCents).toBe(50000);
    expect((await ipc().undoState()).undo).toBe('Use Suggested Budgets');
  });

  it('undo clears the confirmation and puts the budgets back', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    await user.click(within(budgetCard()).getByRole('button', { name: 'Use these budgets' }));
    await within(budgetCard()).findByRole('status');
    await act(() => useUndoStore.getState().undo());
    await waitFor(() => expect(within(budgetCard()).queryByRole('status')).not.toBeInTheDocument());
    expect((await ipc().listCategories()).find((c) => c.name === 'Restaurants')!.budgetCents).toBeNull();
  });

  it('Cancel (or Escape) leaves editing without changing anything', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    expect(within(budgetCard()).queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.click(within(budgetCard()).getByRole('button', { name: 'Adjust' }));
    const field = within(budgetCard()).getByRole('textbox', { name: 'Suggested budget for Restaurants' });
    await user.clear(field);
    await user.type(field, '999');
    await user.click(within(budgetCard()).getByRole('button', { name: 'Cancel' }));
    expect(within(budgetCard()).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(budgetCard()).getByRole('row', { name: /Restaurants/ })).toHaveTextContent(/\$630/);
    await user.click(within(budgetCard()).getByRole('button', { name: 'Adjust' }));
    await user.keyboard('{Escape}');
    expect(within(budgetCard()).queryByRole('textbox')).not.toBeInTheDocument();
    expect((await ipc().listCategories()).find((c) => c.name === 'Restaurants')!.budgetCents).toBeNull();
  });

  it('a category can be left out of the budget, and that is remembered', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    const box = within(budgetCard()).getByRole('checkbox', { name: 'Include Restaurants in the budget' });
    expect(box).toBeChecked();
    await user.click(box);
    expect(within(budgetCard()).getByRole('row', { name: /Restaurants/ })).toHaveTextContent(/\$1,000.*Not budgeted/);
    expect(JSON.parse((await ipc().getSetting('habits_budget_choices'))!)).toEqual({ 2: false });
    await user.click(within(budgetCard()).getByRole('button', { name: 'Use these budgets' }));
    await within(budgetCard()).findByRole('status');
    const after = await ipc().listCategories();
    expect(after.find((c) => c.name === 'Restaurants')!.budgetCents).toBeNull();
    expect(after.find((c) => c.name === 'Shopping')!.budgetCents).toBe(40000);
  });

  it('a header checkbox includes all or none, and shows mixed when some are left out', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    const all = within(budgetCard()).getByRole('checkbox', { name: 'Include all categories' }) as HTMLInputElement;
    expect(all).toBeChecked();
    await user.click(all);
    expect(within(budgetCard()).getByRole('checkbox', { name: 'Include Restaurants in the budget' })).not.toBeChecked();
    expect(within(budgetCard()).getByRole('checkbox', { name: 'Include Shopping in the budget' })).not.toBeChecked();
    expect(all).not.toBeChecked();
    await user.click(within(budgetCard()).getByRole('checkbox', { name: 'Include Shopping in the budget' }));
    expect(all.indeterminate).toBe(true);
    await user.click(all);
    expect(within(budgetCard()).getByRole('checkbox', { name: 'Include Restaurants in the budget' })).toBeChecked();
    expect(JSON.parse((await ipc().getSetting('habits_budget_choices'))!)).toEqual({ 2: true, 3: true });
  });

  it('puts the "even halving" warning below the table, so ticking boxes never moves the table', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    await waitFor(() => expect(budgetCard()).toHaveTextContent('35%'));
    for (let i = 0; i < 5; i++) await user.click(within(budgetCard()).getByRole('button', { name: 'Raise target' }));
    const warning = within(budgetCard()).getByText(/Even halving flexible spending gets you to/);
    const table = within(budgetCard()).getByRole('table');
    expect(table.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides a tip, lists it as hidden, and shows it again', async () => {
    const user = userEvent.setup();
    render(<InsightsPage />);
    await habits();
    const tips = await screen.findByRole('region', { name: 'Tips for you' });
    const card = await within(tips).findByRole('article', { name: /Emergency fund target/ });
    await user.click(within(card).getByRole('button', { name: 'Hide this tip' }));
    expect(within(tips).queryByRole('article', { name: /Emergency fund target/ })).not.toBeInTheDocument();
    await user.click(within(tips).getByRole('button', { name: /1 hidden tip/ }));
    expect(JSON.parse((await ipc().getSetting('hidden_tips'))!)).toEqual([expect.objectContaining({ id: 'emergency', value: 290000 })]);
    await user.click(within(tips).getByRole('button', { name: 'Show again' }));
    expect(await within(tips).findByRole('article', { name: /Emergency fund target/ })).toBeInTheDocument();
  });

  it('drops the old recurring charges card from the range cards', async () => {
    render(<InsightsPage />);
    await habits();
    expect(screen.queryByText(/recurring charges$/)).not.toBeInTheDocument();
  });

  it('says what it needs when there is no history', async () => {
    act(() => setIpc(createMemoryIpc({ groups, categories, transactions: [] })));
    render(<InsightsPage />);
    expect(await habits()).toHaveTextContent('Import a few months of statements to see your money habits.');
  });
});
