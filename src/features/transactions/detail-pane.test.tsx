import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
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
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
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

  it('after a change that moved other rows, says so with Undo and Only this one', async () => {
    const user = userEvent.setup();
    await renderPane(2);
    const keep = vi.spyOn(ipc(), 'keepOnlyThisOne');
    await act(() => useTransactionsStore.getState().setCategory(2, 20));
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent('Moved 1 other Whole Foods transaction to Fuel');
    expect(within(note).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    await user.click(within(note).getByRole('button', { name: 'Only this one' }));
    expect(keep).toHaveBeenCalledWith(2, 20, expect.any(Number));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  it('does not show the note on another transaction', async () => {
    await renderPane(3);
    await act(() => useTransactionsStore.getState().setCategory(2, 20));
    expect(useTransactionsStore.getState().moveNote).not.toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
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
    // Always shown here, so nothing to close.
    expect(within(section).queryByRole('button', { name: 'Close statement details' })).not.toBeInTheDocument();
  });

  it('lists extra statement columns and the file it came from', async () => {
    const section = await renderWith('UBER', { fileName: 'YTD-2026.csv', importedAt: '2026-11-21T15:34:55.365Z', fields: [['Address', '1455 MARKET ST'], ['Status', 'Cleared']] });
    await waitFor(() => expect(within(section).getByText('1455 MARKET ST')).toBeInTheDocument());
    expect(within(section).getByText('Cleared')).toBeInTheDocument();
    expect(within(section).getByText(/YTD-2026\.csv/)).toBeInTheDocument();
    expect(within(section).getByText(/Amex/)).toBeInTheDocument();
  });
});

describe('DetailPane possible duplicate', () => {
  const REASON = 'Same place a day apart as SHAKE SHACK 123 on Nov 17 ($30.31); the amount changed by $6.00 (a tip?).';
  async function renderFlagged(id: number, onOpen = vi.fn()) {
    const ipc = createMemoryIpc({
      sources,
      tags: [{ id: 7, name: 'Possible duplicate', color: '#ddb24a' }],
      transactions: [
        tx({ id: 1, postedOn: '2026-11-17', description: 'SHAKE SHACK 123', merchant: 'shake shack', amountCents: -3031, reviewed: true }),
        tx({ id: 2, postedOn: '2026-11-18', description: 'SHAKE SHACK 123', merchant: 'shake shack', amountCents: -3631, tagIds: [7] }),
      ],
      duplicateFlags: [{ id: 5, txId: 2, otherId: 1, importId: 3, confidence: 'likely', reason: REASON, createdAt: '', resolvedAt: null, resolution: null }],
    });
    setIpc(ipc);
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={id} onPickCategory={() => {}} onOpen={onOpen} />);
    return { ipc, onOpen, box: await screen.findByRole('region', { name: 'Possible duplicate' }) };
  }
  const ids = async (ipc: ReturnType<typeof createMemoryIpc>) => (await ipc.listTransactions({})).map((t) => t.id).sort();

  it('explains why and shows the other transaction, which opens on click', async () => {
    const user = userEvent.setup();
    const { box, onOpen } = await renderFlagged(2);
    expect(box).toHaveTextContent(REASON);
    const other = within(box).getByRole('button', { name: /Open the other transaction/ });
    expect(other).toHaveTextContent('Nov 17');
    expect(other).toHaveTextContent('Shake Shack');
    expect(other).toHaveTextContent('$30.31');
    expect(other).toHaveTextContent('Amex');
    await user.click(other);
    expect(onOpen).toHaveBeenCalledWith(1);
  });

  it('not a duplicate keeps both and clears the tag', async () => {
    const user = userEvent.setup();
    const { box, ipc } = await renderFlagged(2);
    await user.click(within(box).getByRole('button', { name: 'Not a duplicate' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Possible duplicate' })).not.toBeInTheDocument());
    expect(await ids(ipc)).toEqual([1, 2]);
    expect((await ipc.listTransactions({})).find((t) => t.id === 2)?.tagIds).toEqual([]);
  });

  it('delete this one, after a confirm', async () => {
    const user = userEvent.setup();
    const { box, ipc } = await renderFlagged(2);
    await user.click(within(box).getByRole('button', { name: 'Delete this one' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete this transaction?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await ids(ipc)).toEqual([1]));
  });

  it('delete the other one, after a confirm, from either side of the pair', async () => {
    const user = userEvent.setup();
    const { box, ipc } = await renderFlagged(1);
    await user.click(within(box).getByRole('button', { name: 'Delete the other one' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete the other transaction?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await ids(ipc)).toEqual([1]));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Possible duplicate' })).not.toBeInTheDocument());
  });

  it('shows nothing for a transaction without an open flag', async () => {
    await renderPane(1);
    await act(async () => {});
    expect(screen.queryByRole('region', { name: 'Possible duplicate' })).not.toBeInTheDocument();
  });
});

describe('DetailPane in another display currency', () => {
  it('shows the amount converted, and what it originally was', async () => {
    const ipc = createMemoryIpc({ sources, transactions: [tx({ id: 1, postedOn: '2026-10-14', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -6418 })] });
    await ipc.setSetting('display_currency', 'INR');
    setIpc(ipc);
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={1} onPickCategory={() => {}} />);
    expect(screen.getByTestId('detail-amount')).toHaveTextContent('₹');
    expect(screen.getByTestId('detail-original')).toHaveTextContent('Originally $64.18');
  });

  it('shows why a category was chosen, and a suggestion to accept or reject', async () => {
    const user = userEvent.setup();
    setIpc(
      createMemoryIpc({
        sources,
        transactions: [
          tx({ id: 7, postedOn: '2026-11-01', description: 'STARBUCKS 12', merchant: 'starbucks', amountCents: -650, categoryId: 20, categorySource: 'model', categoryReason: 'Like 6 others you put in Fuel (Shell)', suggestedCategoryId: 10, suggestedReason: 'Known merchant: Starbucks' }),
        ],
      }),
    );
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    expect(screen.getByText('Like 6 others you put in Fuel (Shell)')).toBeInTheDocument();
    const box = screen.getByRole('group', { name: 'Suggested category' });
    expect(box).toHaveTextContent('Groceries');
    expect(box).toHaveTextContent('Known merchant: Starbucks');
    await user.click(within(box).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(7)?.categoryId).toBe(10));
    expect(screen.queryByRole('group', { name: 'Suggested category' })).not.toBeInTheDocument();
  });

  it('chooses another category instead of the suggested one', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({ sources, transactions: [tx({ id: 7, postedOn: '2026-11-01', description: 'WISE', merchant: 'wise', amountCents: -50000, categoryId: null, suggestedCategoryId: 20, suggestedReason: 'Like 3 others you put in Fuel' })] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    await user.click(within(screen.getByRole('group', { name: 'Suggested category' })).getByRole('button', { name: 'Choose another' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'gro{Enter}');
    await waitFor(() => expect(useTransactionsStore.getState().byId(7)?.categoryId).toBe(10));
    expect(screen.queryByRole('group', { name: 'Suggested category' })).not.toBeInTheDocument();
  });

  it('a payment app asks before moving the others with its name', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({ sources, transactions: [
      tx({ id: 7, postedOn: '2026-11-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -50000 }),
      tx({ id: 8, postedOn: '2026-10-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -40000 }),
      tx({ id: 9, postedOn: '2026-09-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -30000 }),
      tx({ id: 10, postedOn: '2026-08-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -20000, categoryId: 10, categorySource: 'user' }),
    ] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null, platformOffer: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    await act(() => useTransactionsStore.getState().setCategory(7, 20));
    const ask = await screen.findByRole('region', { name: /Also put other Wise Inc Wise transactions in Fuel\?/ });
    expect(useTransactionsStore.getState().byId(8)?.categoryId).toBeNull();
    expect(within(ask).getByRole('checkbox', { name: /2026-08-01/ })).not.toBeChecked();
    await user.click(within(ask).getByRole('button', { name: 'Statement details for WISE INC WISE on 2026-10-01' }));
    expect(within(ask).getByRole('group', { name: 'Statement for WISE INC WISE' })).toHaveTextContent('Appears on statement as');
    await user.click(within(within(ask).getByRole('group', { name: 'Statement for WISE INC WISE' })).getByRole('button', { name: 'Close statement details' }));
    expect(within(ask).queryByRole('group', { name: 'Statement for WISE INC WISE' })).not.toBeInTheDocument();
    await user.click(within(ask).getByRole('checkbox', { name: /2026-09-01/ }));
    await user.click(within(ask).getByRole('button', { name: 'Apply to 1' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(8)?.categoryId).toBe(20));
    expect(useTransactionsStore.getState().byId(9)?.categoryId).toBeNull();
    expect(useTransactionsStore.getState().byId(10)?.categoryId).toBe(10);
    expect(screen.queryByRole('region', { name: /Also put other/ })).not.toBeInTheDocument();
  });

  it('Just this one closes the question without moving anything', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({ sources, transactions: [
      tx({ id: 7, postedOn: '2026-11-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -50000 }),
      tx({ id: 8, postedOn: '2026-10-01', description: 'WISE INC WISE', merchant: 'wise inc wise', amountCents: -40000 }),
    ] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null, platformOffer: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    await act(() => useTransactionsStore.getState().setCategory(7, 20));
    await user.click(within(await screen.findByRole('region', { name: /Also put other/ })).getByRole('button', { name: 'Just this one' }));
    expect(screen.queryByRole('region', { name: /Also put other/ })).not.toBeInTheDocument();
    expect(useTransactionsStore.getState().byId(8)?.categoryId).toBeNull();
  });

  it('rejecting a suggestion keeps the category', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({ sources, transactions: [tx({ id: 7, postedOn: '2026-11-01', description: 'X', merchant: 'x', amountCents: -650, categoryId: 20, suggestedCategoryId: 10 })] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={7} onPickCategory={() => {}} />);
    await user.click(within(screen.getByRole('group', { name: 'Suggested category' })).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Suggested category' })).not.toBeInTheDocument());
    expect(useTransactionsStore.getState().byId(7)?.categoryId).toBe(20);
  });

  it('links a transfer to its other side', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    setIpc(createMemoryIpc({ sources, transactions: [
      tx({ id: 8, postedOn: '2026-11-01', description: 'TRANSFER', merchant: 'transfer', amountCents: -50000, txType: 'transfer', transferPairId: 9, categoryReason: 'Transfer to Savings', categorySource: 'transfer' }),
      tx({ id: 9, postedOn: '2026-11-02', description: 'TRANSFER', merchant: 'transfer', amountCents: 50000, txType: 'transfer', transferPairId: 8 }),
    ] }));
    useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
    await useTransactionsStore.getState().load(null);
    render(<DetailPane id={8} onPickCategory={() => {}} onOpen={onOpen} />);
    await user.click(screen.getByRole('button', { name: 'Transfer to Savings' }));
    expect(onOpen).toHaveBeenCalledWith(9);
  });
});
