import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { DetailPane, ReviewButton } from './detail-pane';
import { useTransactionsStore } from './transactions-store';

afterEach(() => cleanup());

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'description' | 'amountCents' | 'merchant'>): Transaction {
  return { profileId: 1, sourceId: 1, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over };
}

const sources: Source[] = [{ id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: 'American Express', currency: 'USD' }];
const seed = {
  sources,
  transactions: [
    tx({ id: 1, postedOn: '2026-11-14', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -6418, categoryId: 10, notes: 'groceries run' }),
    tx({ id: 2, postedOn: '2026-10-20', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -5000 }),
    tx({ id: 3, postedOn: '2026-11-10', description: 'PAYROLL', merchant: 'payroll', amountCents: 325000 }),
  ],
};

async function renderPane(id: number | null, onPickCategory = () => {}, onClose = () => {}) {
  setIpc(createMemoryIpc(seed));
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, offer: null, notice: null });
  await useTransactionsStore.getState().load(null);
  render(
    <>
      {id != null && <ReviewButton id={id} />}
      <DetailPane id={id} onClose={onClose} onPickCategory={onPickCategory} />
    </>,
  );
}

describe('DetailPane', () => {
  it('renders nothing when no transaction is selected', async () => {
    await renderPane(null);
    expect(screen.queryByLabelText('Transaction detail')).not.toBeInTheDocument();
  });

  it('shows amount, category, source and notes', async () => {
    await renderPane(1);
    expect(screen.getByRole('heading', { name: 'Whole Foods' })).toBeInTheDocument();
    expect(screen.getByTestId('detail-amount')).toHaveTextContent('$64.18');
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Account' })).toHaveTextContent('Amex');
    expect(screen.getByText('Saturday, Nov 14, 2026')).toBeInTheDocument();
    expect(screen.getByText('To review')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('groceries run');
  });

  it('lists similar transactions by month with day headers and full rows', async () => {
    await renderPane(1);
    const section = screen.getByLabelText('Similar transactions');
    expect(section).toHaveTextContent('October 2026');
    expect(section).toHaveTextContent('Tue, October 20');
    expect(within(section).getAllByRole('row')).toHaveLength(1);
    expect(within(section).getByTestId('amount')).toHaveTextContent('$50.00');
  });

  it('shows income in green without a sign, and no similar section when unique', async () => {
    await renderPane(3);
    expect(screen.getByTestId('detail-amount')).toHaveTextContent('$3,250.00');
    expect((screen.getByTestId('detail-amount').firstElementChild as HTMLElement).style.color).toBe('var(--pos)');
    expect(screen.queryByLabelText('Similar transactions')).not.toBeInTheDocument();
  });

  it('persists notes on blur', async () => {
    const user = userEvent.setup();
    await renderPane(1);
    const box = screen.getByRole('textbox');
    await user.clear(box);
    await user.type(box, 'updated note');
    await user.tab();
    await waitFor(() => expect(useTransactionsStore.getState().byId(1)!.notes).toBe('updated note'));
  });

  it('toggles reviewed and opens the category picker', async () => {
    const user = userEvent.setup();
    const onPickCategory = vi.fn();
    await renderPane(1, onPickCategory);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(1)!.reviewed).toBe(true));
    expect(screen.getByRole('button', { name: 'Reviewed' })).toBeInTheDocument();
    expect(screen.queryByText('To review')).not.toBeInTheDocument();
    await user.click(screen.getByText('Groceries'));
    expect(onPickCategory).toHaveBeenCalledWith(1);
  });

  it('splits a transaction into parts that must balance, then lists them', async () => {
    const user = userEvent.setup();
    await renderPane(1); // -$64.18
    await user.click(screen.getByRole('button', { name: 'Split transaction' }));
    // seeded: part 1 = -64.18, part 2 = 0.00 → already balanced
    const save = screen.getByRole('button', { name: 'Save split' });
    expect(save).toBeEnabled();
    // unbalance it, Save disables
    const p2 = screen.getByLabelText('Part 2 amount');
    await user.clear(p2);
    await user.type(p2, '-10.00');
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
    expect(screen.getByText('+$10.00 left')).toBeInTheDocument();
    // rebalance part 1 to -54.18
    const p1 = screen.getByLabelText('Part 1 amount');
    await user.clear(p1);
    await user.type(p1, '-54.18');
    await user.click(screen.getByRole('button', { name: 'Save split' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit split' })).toBeInTheDocument());
    const list = screen.getByLabelText('Split');
    expect(list).toHaveTextContent('$54.18');
    expect(list).toHaveTextContent('$10.00');
  });

  it('adds and removes parts', async () => {
    const user = userEvent.setup();
    await renderPane(1);
    await user.click(screen.getByRole('button', { name: 'Split transaction' }));
    await user.click(screen.getByRole('button', { name: '+ Add part' }));
    expect(screen.getByLabelText('Part 3 amount')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove part 3' }));
    expect(screen.queryByLabelText('Part 3 amount')).not.toBeInTheDocument();
  });

  it('shows the apply-to-others offer after a category change, then the result', async () => {
    const user = userEvent.setup();
    await renderPane(2);
    await act(() => useTransactionsStore.getState().setCategory(2, 20));
    const offer = await screen.findByRole('region', { name: /Apply .Fuel. to other transactions/ });
    await user.click(within(offer).getByRole('button', { name: 'Apply to 1' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved 1 transaction to Fuel.');
    expect(screen.queryByRole('region', { name: /Apply/ })).not.toBeInTheDocument();
  });

  it('does not show the offer for another transaction', async () => {
    await renderPane(3);
    await act(() => useTransactionsStore.getState().setCategory(2, 20));
    await waitFor(() => expect(useTransactionsStore.getState().offer).not.toBeNull());
    expect(screen.queryByRole('region', { name: /Apply/ })).not.toBeInTheDocument();
  });

  it('changes the type; a transfer shows Transfer instead of a category', async () => {
    const user = userEvent.setup();
    await renderPane(1);
    const type = screen.getByRole('radiogroup', { name: 'Type' });
    expect(within(type).getByRole('radio', { name: 'Regular' })).toBeChecked();
    await user.click(within(type).getByRole('radio', { name: 'Internal transfer' }));
    await waitFor(() => expect(within(type).getByRole('radio', { name: 'Internal transfer' })).toBeChecked());
    const detail = screen.getByRole('article', { name: 'Transaction detail' });
    expect(within(detail).getByText('Transfer')).toBeInTheDocument();
    expect(useTransactionsStore.getState().byId(1)).toMatchObject({ txType: 'transfer', categoryId: null });
  });

  it('makes a transaction recurring, shows its bill, and unlinks it', async () => {
    const user = userEvent.setup();
    await renderPane(1);
    const detail = () => screen.getByRole('article', { name: 'Transaction detail' });
    await user.click(within(detail()).getByRole('button', { name: 'Make recurring' }));
    const form = await screen.findByRole('dialog', { name: 'New recurring' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Whole Foods');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(detail()).findByText('Whole Foods', { selector: '[data-testid="recurring-name"]' })).toBeInTheDocument();
    await user.click(within(detail()).getByRole('button', { name: 'Not recurring' }));
    await waitFor(() => expect(within(detail()).getByRole('button', { name: 'Make recurring' })).toBeInTheDocument());
  });
});

describe('DetailPane statement section', () => {
  async function renderWith(description: string, statement?: { fileName: string; importedAt: string; fields: [string, string][] }) {
    setIpc(
      createMemoryIpc({
        sources,
        transactions: [tx({ id: 7, postedOn: '2026-11-14', description, merchant: 'gantry public house', amountCents: -4200 })],
        statements: statement ? { 7: statement } : undefined,
      }),
    );
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, offer: null, notice: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    return screen.findByRole('group', { name: 'Statement' });
  }

  it('shows the line as it appears on the statement, with the clues read from it', async () => {
    const section = await renderWith('TST* GANTRY PUBLIC HOUSE SEATTLE WA');
    expect(within(section).getByText('TST* GANTRY PUBLIC HOUSE SEATTLE WA')).toBeInTheDocument();
    const row = (label: string) => within(section).getByText(label).closest('[data-row]');
    expect(row('Paid through')).toHaveTextContent('Toast');
    expect(row('Location')).toHaveTextContent('Seattle, WA');
  });

  it('lists extra statement columns and the file it came from', async () => {
    const section = await renderWith('UBER', { fileName: 'YTD-2026.csv', importedAt: '2026-11-21T15:34:55.365Z', fields: [['Address', '1455 MARKET ST'], ['Status', 'Cleared']] });
    await waitFor(() => expect(within(section).getByText('1455 MARKET ST')).toBeInTheDocument());
    expect(within(section).getByText('Cleared')).toBeInTheDocument();
    expect(within(section).getByText(/YTD-2026\.csv/)).toBeInTheDocument();
    expect(within(section).getByText(/Amex/)).toBeInTheDocument();
  });
});
