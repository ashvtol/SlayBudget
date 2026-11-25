import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { plotArea } from '@/features/charts/svg/frame';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';
import { CashflowPage } from './cashflow-page';

afterEach(() => cleanup());

let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number | null = null): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: amountCents > 0 ? 'income' : 'regular',
});
const categories: Category[] = [
  { id: 10, groupId: 1, name: 'Groceries', emoji: '🥑', color: '#e8743b', budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false },
  { id: 99, groupId: 1, name: 'Card Payment', emoji: null, color: null, budgetCents: null, excluded: true, kind: 'transfer', sortOrder: 1, archived: false },
];

async function setup() {
  setIpc(createMemoryIpc({
    categories,
    transactions: [
      tx('2026-02-01', 400000),
      tx('2026-11-03', -12000, 10),
      tx('2026-11-04', -100000, 99),
      tx('2025-05-01', -5000, 10),
    ],
  }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21' });
  render(<CashflowPage />);
  await screen.findByRole('region', { name: 'Net income' });
}

const card = (name: string) => screen.getByRole('region', { name });

describe('CashflowPage', () => {
  it('defaults to year to date compared with the previous period', async () => {
    await setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Cash flow' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveValue('ytd');
    expect(screen.getByRole('combobox', { name: 'Compared to' })).toHaveValue('previousPeriod');
    expect(screen.getByText('Jan 1, 2026 - Nov 21, 2026', { selector: 'header *' })).toBeInTheDocument();
  });

  it('shows net income, spend and income with their change against the comparison', async () => {
    await setup();
    await waitFor(() => expect(card('Net income')).toHaveTextContent('$3,880.00'));
    expect(card('Net income')).toHaveTextContent('in Jan 1, 2025 - Nov 21, 2025');
    expect(within(card('Net income')).getByLabelText('Net income by month')).toBeInTheDocument();
    expect(card('Spend')).toHaveTextContent('$120.00');
    expect(within(card('Spend')).getByLabelText(/^Up/)).toBeInTheDocument();
    expect(card('Income')).toHaveTextContent('$4,000.00');
  });

  it('hovering a month turns the card header into that month (no tooltip box), and leaving puts the period back', async () => {
    await setup();
    await waitFor(() => expect(card('Net income')).toHaveTextContent('$3,880.00'));
    const chart = within(card('Net income')).getByRole('img', { name: 'Net income by month' });
    const area = plotArea(560, 150);
    const months = within(card('Net income')).getAllByRole('row').length - 1; // the screen-reader table
    fireEvent.pointerMove(chart, { clientX: area.left + (area.width / months) * 1.5 }); // February
    expect(card('Net income')).toHaveTextContent('Feb 2026');
    expect(card('Net income')).toHaveTextContent('$4,000.00');
    expect(card('Net income')).toHaveTextContent('vs $0.00 in Feb 2025');
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerLeave(chart);
    expect(card('Net income')).toHaveTextContent('Jan 1, 2026 - Nov 21, 2026');
    expect(card('Net income')).toHaveTextContent('$3,880.00');
  });

  it('Income scrubs the same way', async () => {
    await setup();
    await waitFor(() => expect(card('Income')).toHaveTextContent('$4,000.00'));
    const chart = within(card('Income')).getByRole('img', { name: 'Income by month' });
    const area = plotArea(560, 130);
    const months = within(card('Income')).getAllByRole('row').length - 1;
    fireEvent.pointerMove(chart, { clientX: area.left + (area.width / months) * 0.5 }); // January
    expect(card('Income')).toHaveTextContent('Jan 2026');
    expect(card('Income')).toHaveTextContent('$0.00');
  });

  it('Spend scrubs too, and shows a card with that month’s categories', async () => {
    await setup();
    await waitFor(() => expect(card('Spend')).toHaveTextContent('$120.00'));
    const chart = within(card('Spend')).getByRole('img', { name: 'Spend by month' });
    const area = plotArea(560, 150);
    const months = within(card('Spend')).getAllByRole('row').length - 1;
    fireEvent.pointerMove(chart, { clientX: area.left + (area.width / months) * 10.5 }); // November
    expect(card('Spend')).toHaveTextContent('Nov 2026');
    const monthCard = within(card('Spend')).getByRole('group', { name: 'Nov 2026: spending by category' });
    expect(within(monthCard).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['🥑Groceries$120.00']);
    fireEvent.pointerLeave(chart);
    expect(within(card('Spend')).queryByRole('group')).toBeNull();
  });

  it('switches the period', async () => {
    const user = userEvent.setup();
    await setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'month');
    await waitFor(() => expect(card('Income')).toHaveTextContent('Nov 1, 2026 - Nov 21, 2026'));
    expect(card('Income')).toHaveTextContent('$0.00');
  });

  it('includes excluded spend when the switch is on', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByRole('switch', { name: 'Show excluded spend' }));
    await waitFor(() => expect(card('Spend')).toHaveTextContent('$1,120.00'));
  });

  it('opens the spend details drawer from View more', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(card('Spend')).getByRole('button', { name: /View more/i }));
    const drawer = screen.getByRole('dialog', { name: 'Spend' });
    expect(within(drawer).getByRole('table', { name: 'Key metrics' })).toHaveTextContent('2026');
    expect(within(drawer).getByRole('list', { name: 'Categories' })).toHaveTextContent('Groceries');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('in the details, clicking a month shows its total and categories; pointing alone changes nothing', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(card('Spend')).getByRole('button', { name: /View more/i }));
    const drawer = screen.getByRole('dialog', { name: 'Spend' });
    const header = () => within(drawer).getByRole('group', { name: 'Shown month' });
    const list = () => within(drawer).getByRole('list', { name: 'Categories' });
    expect(header()).toHaveTextContent('November 2026$120.00');
    const chart = within(drawer).getByRole('img', { name: 'Spend over two years' });
    const area = plotArea(560, 130);
    const months = 24;
    const at = (i: number) => ({ clientX: area.left + (area.width / months) * (i + 0.5) });
    fireEvent.pointerMove(chart, at(5)); // May 2025
    expect(header()).toHaveTextContent('November 2026');
    fireEvent.click(chart);
    fireEvent.pointerLeave(chart);
    expect(header()).toHaveTextContent('May 2025$50.00');
    expect(list()).toHaveTextContent('Groceries');
    expect(list()).toHaveTextContent('$50.00');
    expect(within(drawer).getByRole('heading', { name: 'Categories in May 2025' })).toBeInTheDocument();
    fireEvent.pointerMove(chart, at(5));
    fireEvent.click(chart);
    expect(header()).toHaveTextContent('November 2026');
  });

  it('compares with the previous year when chosen', async () => {
    const user = userEvent.setup();
    await setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'month');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Compared to' }), 'previousYear');
    await waitFor(() => expect(card('Net income')).toHaveTextContent('in Nov 1, 2025 - Nov 21, 2025'));
  });

  it("offers Copilot's ranges: last 3 months and last 4 weeks", async () => {
    const user = userEvent.setup();
    await setup();
    const options = [...(screen.getByRole('combobox', { name: 'Period' }) as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toEqual(['Year to date', 'This month', 'Last 12 months', 'Last 3 months', 'Last 4 weeks']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'last4w');
    await waitFor(() => expect(card('Spend')).toHaveTextContent('Oct 25, 2026 - Nov 21, 2026'));
    expect(card('Spend')).toHaveTextContent('in Sep 27, 2026 - Oct 24, 2026');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Period' }), 'last3');
    await waitFor(() => expect(card('Spend')).toHaveTextContent('Sep 1, 2026 - Nov 21, 2026'));
  });

  it('hides the comparison when asked', async () => {
    const user = userEvent.setup();
    await setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Compared to' }), 'none');
    await waitFor(() => expect(card('Spend')).not.toHaveTextContent('vs'));
    expect(within(card('Spend')).queryByLabelText(/^Up|^Down/)).not.toBeInTheDocument();
    expect(card('Spend')).toHaveTextContent('$120.00');
  });

  it('Income details list every source with who paid it, and you choose which categories count', async () => {
    const user = userEvent.setup();
    const income = (id: number, name: string): Category => ({ ...categories[0], id, name, emoji: null, kind: 'income' });
    const row = (postedOn: string, cents: number, categoryId: number, merchant: string) => ({ ...tx(postedOn, cents, categoryId), merchant });
    setIpc(createMemoryIpc({
      categories: [...categories, income(30, 'Paycheck'), income(31, 'Interest')],
      transactions: [row('2026-11-01', 400000, 30, 'acme corp'), row('2026-11-02', 1000, 31, 'big bank'), row('2026-11-03', -12000, 10, 'whole foods')],
    }));
    useProfileStore.setState({ activeProfileId: null });
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<CashflowPage />);
    await waitFor(() => expect(card('Income')).toHaveTextContent('$4,010.00'));
    await user.click(within(card('Income')).getByRole('button', { name: /View more/i }));
    const drawer = screen.getByRole('dialog', { name: 'Income' });
    expect(within(drawer).getByRole('table', { name: 'Key metrics' })).toHaveTextContent('Avg monthly income');
    const sources = within(drawer).getByRole('list', { name: 'Categories' });
    expect(within(sources).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['PaycheckAcme Corp$4,000.00', 'InterestBig Bank$10.00']);
    await user.click(within(drawer).getByRole('button', { name: 'Choose categories' }));
    const choose = screen.getByRole('group', { name: 'Count in Income' });
    expect(within(choose).getByRole('checkbox', { name: 'Paycheck' })).toBeChecked();
    await user.click(within(choose).getByRole('checkbox', { name: 'Interest' }));
    await waitFor(() => expect(card('Income')).toHaveTextContent('$4,000.00'));
    expect(JSON.parse((await ipc().getSetting('cashflow_hidden'))!)).toEqual({ spend: [], income: ['31'] });
    await user.click(within(drawer).getByRole('button', { name: 'Choose categories' }));
    expect(within(drawer).getByRole('button', { name: 'Choose categories' })).toHaveTextContent('1 hidden');
  });

  it('Spend details choose their categories the same way', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(card('Spend')).getByRole('button', { name: /View more/i }));
    const drawer = screen.getByRole('dialog', { name: 'Spend' });
    await user.click(within(drawer).getByRole('button', { name: 'Choose categories' }));
    await user.click(within(screen.getByRole('group', { name: 'Count in Spend' })).getByRole('checkbox', { name: /Groceries/ }));
    await waitFor(() => expect(card('Spend')).toHaveTextContent('$0.00'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Count in Spend' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Spend' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog', { name: 'Spend' })).getByRole('button', { name: 'Choose categories' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Spend' })).getByRole('table', { name: 'Key metrics' }));
    expect(screen.queryByRole('group', { name: 'Count in Spend' })).not.toBeInTheDocument();
  });
});

