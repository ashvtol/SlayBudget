import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useNavStore } from '@/lib/stores/nav-store';
import { useAnalyticsStore } from './analytics-store';
import { DashboardPage } from './dashboard-page';
import { useTransactionsStore } from '@/features/transactions/transactions-store';

afterEach(() => cleanup());

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'amountCents'>): Transaction {
  return { profileId: 1, sourceId: 1, description: 'X', merchant: 'x', currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: over.amountCents > 0 ? 'income' : 'regular', ...over };
}

const sources: Source[] = [{ id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: null, currency: 'USD' }];
const TODAY = '2026-11-17';

// Default memory categories: Groceries (10, budget $600) in Food & Drink, Fuel (20, budget $150) in Transportation.
async function setup(before?: () => Promise<void>) {
  setIpc(createMemoryIpc({
    sources,
    transactions: [
      tx({ id: 1, postedOn: '2026-11-02', amountCents: 500000, description: 'PAYROLL', merchant: 'payroll' }),
      tx({ id: 2, postedOn: '2026-11-05', amountCents: -12000, categoryId: 10, description: 'WHOLE FOODS', merchant: 'whole foods', reviewed: false }),
      tx({ id: 3, postedOn: '2026-11-06', amountCents: -8000, categoryId: 20, description: 'SHELL', merchant: 'shell' }),
      tx({ id: 4, postedOn: '2026-08-20', amountCents: -1799, description: 'NETFLIX', merchant: 'netflix' }),
      tx({ id: 5, postedOn: '2026-09-20', amountCents: -1799, description: 'NETFLIX', merchant: 'netflix' }),
      tx({ id: 6, postedOn: '2026-10-20', amountCents: -1799, description: 'NETFLIX', merchant: 'netflix' }),
    ],
  }));
  await before?.();
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: TODAY });
  useNavStore.setState({ section: 'dashboard' });
  render(<DashboardPage />);
  await screen.findByText(/(left|spent)$/);
}

const card = (name: string) => screen.getByRole('region', { name });

describe('DashboardPage', () => {
  it('shows what is left of the monthly budget', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    const spending = card('Monthly spending');
    // $750 budgeted; Netflix ($17.99, a saved monthly bill due Nov 20) is set aside; $200 spent.
    expect(spending).toHaveTextContent('$532 left');
    expect(spending).toHaveTextContent('out of $750 budgeted · $18 in bills set aside');
    expect(within(spending).getByLabelText('Spending this month against budget')).toBeInTheDocument();
  });

  it('sets recurring bills aside: what is left is free to spend', async () => {
    // Shell ($80, paid) joins Netflix ($18, due) as bills: $750 - $98 = $652 free, $120 spent outside bills.
    await setup(async () => {
      await ipc().createRecurring({ name: 'Shell', categoryId: 20, matchKind: 'merchant', pattern: 'shell', minCents: 7000, maxCents: 9000, frequency: 'monthly', dayOfMonth: 6 });
    });
    const spending = card('Monthly spending');
    expect(spending).toHaveTextContent('$532 left');
    expect(spending).toHaveTextContent('$98 in bills set aside');
  });

  it('without any budget, shows what was spent instead of "over"', async () => {
    await setup(async () => {
      await ipc().setBudget(10, null, null);
      await ipc().setBudget(20, null, null);
    });
    const spending = card('Monthly spending');
    await waitFor(() => expect(spending).toHaveTextContent('$200 spent'));
    expect(spending).toHaveTextContent('No budget set');
    expect(spending).not.toHaveTextContent('over');
  });

  it("uses this month's budget from the plan", async () => {
    // Groceries has $800 for November only: 800 + 150.
    await setup(() => ipc().setBudget(10, '2026-11', 80000));
    expect(card('Monthly spending')).toHaveTextContent('out of $950 budgeted');
  });

  it('lists transactions to review', async () => {
    await setup();
    const review = card('Transactions to review');
    expect(within(review).getAllByRole('row')).toHaveLength(1);
    expect(review).toHaveTextContent('Whole Foods');
    // Groceries has no color of its own: its pill takes Food & Drink's orange.
    expect(within(review).getByRole('button', { name: /Groceries/ }).style.background).toContain('rgb(255, 149, 0)');
  });

  it('shows top categories with spend against budget', async () => {
    await setup();
    const top = card('Top categories');
    expect(top).toHaveTextContent('Food & Drink');
    expect(within(top).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$120');
    expect(within(top).getByRole('row', { name: /Groceries/ })).toHaveTextContent('$600');
  });

  it('nets this month and compares with the same days last month', async () => {
    await setup();
    const net = card('Net this month');
    expect(net).toHaveTextContent('$4,800.00');
    expect(net).toHaveTextContent('in Oct 1 - Oct 17, 2026');
    expect(net).toHaveTextContent('Income$5,000.00');
    expect(net).toHaveTextContent('Spend$200.00');
  });

  it('lists recurring charges due in the next two weeks', async () => {
    await setup();
    await waitFor(() => expect(card('Next two weeks')).toHaveTextContent('Netflix'));
  });

  it('puts Next two weeks in the left column, under Net this month; Tips and Top categories on the right', async () => {
    await setup();
    const left = card('Monthly spending').parentElement!;
    expect(left).toContainElement(card('Net this month'));
    expect(left).toContainElement(card('Next two weeks'));
    expect(card('Net this month').compareDocumentPosition(card('Next two weeks')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(left).not.toContainElement(card('Top categories'));
  });

  it('links each card to its screen and has no range picker', async () => {
    const user = userEvent.setup();
    await setup();
    expect(screen.queryByRole('radiogroup', { name: 'Time range' })).not.toBeInTheDocument();
    await user.click(within(card('Net this month')).getByRole('button', { name: /Cash flow/i }));
    expect(useNavStore.getState().section).toBe('cashflow');
    await user.click(within(card('Top categories')).getByRole('button', { name: /View all/i }));
    expect(useNavStore.getState().section).toBe('categories');
    await user.click(within(card('Next two weeks')).getByRole('button', { name: /Recurrings/i }));
    expect(useNavStore.getState().section).toBe('recurring');
  });

  it('collapses a category group', async () => {
    const user = userEvent.setup();
    await setup();
    const top = card('Top categories');
    await user.click(within(top).getByRole('button', { name: 'Collapse Food & Drink' }));
    expect(within(top).queryByRole('row', { name: /Groceries/ })).not.toBeInTheDocument();
  });

  it('shows the Other clean-up row', async () => {
    const user = userEvent.setup();
    await setup();
    const review = card('Transactions to review');
    // Uncategorized rows count as Other: payroll and three Netflix charges.
    await waitFor(() => expect(review).toHaveTextContent('4 in Other'));
    await user.click(within(review).getByRole('button', { name: 'Clean up Other' }));
    expect(useNavStore.getState()).toMatchObject({ section: 'categories', cleanUpOther: true });
  });

  it('has no suggestion row when nothing is suggested', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Check suggested categories' })).not.toBeInTheDocument();
  });

  it('says how many categories are suggested and opens them', async () => {
    const user = userEvent.setup();
    await setup(async () => {
      setIpc(createMemoryIpc({ sources, transactions: [tx({ id: 9, postedOn: '2026-11-03', amountCents: -500, categoryId: 20, suggestedCategoryId: 10 })] }));
    });
    const review = await screen.findByRole('button', { name: 'Check suggested categories' });
    expect(review.parentElement).toHaveTextContent('1 suggested category');
    await user.click(review);
    await waitFor(() => expect(useTransactionsStore.getState().filter.suggested).toBe(true));
    expect(useNavStore.getState().section).toBe('transactions');
  });

  it('opens a transaction to review on the Transactions screen', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(card('Transactions to review')).getByText('Whole Foods'));
    expect(useNavStore.getState().section).toBe('transactions');
  });

  it('says how much over budget when spending passes it', async () => {
    setIpc(createMemoryIpc({ sources, transactions: [tx({ id: 1, postedOn: '2026-11-05', amountCents: -100000, categoryId: 10 })] }));
    useAnalyticsStore.setState({ today: TODAY });
    render(<DashboardPage />);
    // The header says how far over the budget; the chart's pill says how far ahead of the even pace.
    const overs = await screen.findAllByText(/over$/);
    expect(overs.map((o) => o.textContent)).toContain('$250 over');
  });
});
