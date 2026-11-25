import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { TransactionsPage } from './transactions-page';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useTransactionsStore } from './transactions-store';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44 })),
    measureElement: () => {},
  }),
}));

afterEach(() => cleanup());

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'description' | 'merchant' | 'amountCents'>): Transaction {
  return { profileId: 1, sourceId: 1, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over };
}
const sources: Source[] = [
  { id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: null, currency: 'USD' },
  { id: 2, profileId: 1, name: 'Citi', kind: 'pdf', institution: null, currency: 'USD' },
];
const seed = {
  sources,
  transactions: [
    tx({ id: 1, postedOn: '2026-11-15', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -6418, categoryId: 10, reviewed: true }),
    tx({ id: 2, postedOn: '2026-11-10', description: 'SHELL OIL', merchant: 'shell', amountCents: -4800, sourceId: 2 }),
  ],
};

async function renderPage(over: Partial<typeof seed> = {}) {
  setIpc(createMemoryIpc({ ...seed, ...over }));
  useTransactionsStore.setState({ transactions: [], filter: {}, sort: 'newest', selected: new Set(), cursor: 0, focused: null });
  useProfileStore.setState({ profiles: [], activeProfileId: null });
  render(<TransactionsPage />);
  await screen.findByRole('row', { name: /Whole Foods/ });
}

const list = () => screen.getByRole('grid', { name: 'Transactions' });
const listNames = () => within(list()).getAllByRole('row').map((r) => (r.textContent?.includes('Whole Foods') ? 'whole' : 'shell'));
const details = () => screen.getByRole('region', { name: 'Details' });

describe('TransactionsPage', () => {
  it('is a list with an always-visible detail panel showing the newest transaction', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'All transactions' })).toBeInTheDocument();
    expect(within(details()).getByRole('heading', { name: 'Whole Foods' })).toBeInTheDocument();
    expect(within(details()).getByRole('button', { name: 'Reviewed' })).toBeInTheDocument();
  });

  it('shows a clicked row in the detail panel', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(list()).getByText('Shell'));
    expect(within(details()).getByRole('heading', { name: 'Shell' })).toBeInTheDocument();
    expect(within(details()).getByRole('button', { name: 'Review' })).toBeInTheDocument();
  });

  it('opens the transaction another screen asked for on the first visit, while the page loads too', async () => {
    setIpc(createMemoryIpc(seed));
    useTransactionsStore.setState({ transactions: [], filter: {}, sort: 'newest', selected: new Set(), cursor: 0, focused: null });
    useProfileStore.setState({ profiles: [], activeProfileId: null });
    const asked = useTransactionsStore.getState().focusById(2);
    render(<TransactionsPage />);
    await asked;
    expect(await within(details()).findByRole('heading', { name: 'Shell' })).toBeInTheDocument();
  });

  it('opens the transaction a notification points at, even after you clicked another row', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(list()).getByText('Whole Foods'));
    const { openTarget } = await import('@/features/notifications/route');
    await openTarget({ kind: 'transaction', id: 2 });
    expect(await within(details()).findByRole('heading', { name: 'Shell' })).toBeInTheDocument();
  });

  const openFilter = async (user: ReturnType<typeof userEvent.setup>, item: string) => {
    await user.click(screen.getByRole('button', { name: /Filter/ }));
    const menu = screen.getByRole('menu', { name: 'Filters' });
    await user.click(within(menu).getByRole('menuitem', { name: item }));
    return screen.findByRole('menu', { name: item });
  };

  it('offers Copilot\'s filter items', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    const items = within(screen.getByRole('menu', { name: 'Filters' })).getAllByRole('menuitem').map((m) => m.textContent);
    expect(items).toEqual(['Account', 'Category', 'Date', 'Keywords', 'Recurring', 'Review status', 'Tags', 'Type']);
  });

  it('filters by review status with a removable pill', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sub = await openFilter(user, 'Review status');
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: 'Not reviewed' }));
    await waitFor(() => expect(listNames()).toEqual(['shell']));
    expect(screen.getByRole('button', { name: '+ Filter' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Not reviewed filter' }));
    await waitFor(() => expect(listNames()).toEqual(['whole', 'shell']));
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
  });

  it('filters to suggested categories and accepts them all', async () => {
    const user = userEvent.setup();
    await renderPage({
      transactions: [
        ...seed.transactions,
        tx({ id: 3, postedOn: '2026-11-12', description: 'TRADER JOES', merchant: 'trader joes', amountCents: -900, suggestedCategoryId: 10, suggestedReason: 'Known merchant: Trader Joes' }),
      ],
    });
    expect(screen.queryByRole('button', { name: 'Accept all' })).not.toBeInTheDocument();
    await user.click(within(await openFilter(user, 'Review status')).getByRole('menuitemcheckbox', { name: 'Suggested category' }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Accept all' }));
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Transactions' })).not.toBeInTheDocument());
    expect(useTransactionsStore.getState().filter.suggested).toBe(true);
  });

  it('filters by a searched category', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sub = await openFilter(user, 'Category');
    await user.type(within(sub).getByRole('textbox', { name: 'Search Category' }), 'gro');
    expect(within(sub).queryByRole('menuitemcheckbox', { name: /Fuel/ })).not.toBeInTheDocument();
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: /Groceries/ }));
    await waitFor(() => expect(listNames()).toEqual(['whole']));
    expect(screen.getByRole('button', { name: 'Remove Groceries filter' })).toBeInTheDocument();
  });

  it('filters by account', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sub = await openFilter(user, 'Account');
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: /Citi/ }));
    await waitFor(() => expect(listNames()).toEqual(['shell']));
  });

  it('filters by month from the year submenu, only offering months with data', async () => {
    const user = userEvent.setup();
    await renderPage({
      transactions: [...seed.transactions, tx({ id: 3, postedOn: '2025-12-20', description: 'SHELL OIL', merchant: 'shell', amountCents: -3000 })],
    });
    const sub = await openFilter(user, 'Date');
    expect(within(sub).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['2026', '2025']);
    await user.click(within(sub).getByRole('menuitem', { name: '2025' }));
    const months = await screen.findByRole('menu', { name: '2025' });
    expect(within(months).getAllByRole('menuitemcheckbox').map((m) => m.textContent)).toEqual(['December']);
    await user.click(within(months).getByRole('menuitemcheckbox', { name: 'December' }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Remove December 2025 filter' })).toBeInTheDocument();
  });

  it('filters by type', async () => {
    const user = userEvent.setup();
    await renderPage({
      transactions: [...seed.transactions, tx({ id: 3, postedOn: '2026-11-12', description: 'PAYROLL', merchant: 'payroll', amountCents: 500000, txType: 'income' })],
    });
    const sub = await openFilter(user, 'Type');
    expect(within(sub).getAllByRole('menuitemcheckbox').map((m) => m.textContent)).toEqual(['Regular', 'Income', 'Internal transfer']);
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: 'Income' }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Remove Income filter' })).toBeInTheDocument();
  });

  it('filters by a keyword', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sub = await openFilter(user, 'Keywords');
    await user.type(within(sub).getByRole('textbox', { name: 'Keyword' }), 'shell{Enter}');
    await waitFor(() => expect(listNames()).toEqual(['shell']));
    expect(screen.getByRole('button', { name: 'Remove “shell” filter' })).toBeInTheDocument();
  });

  it('filters by a recurring bill', async () => {
    const user = userEvent.setup();
    const netflix = [1, 2, 3].map((i) => tx({ id: 10 + i, postedOn: `2026-0${6 + i}-05`, description: 'NETFLIX', merchant: 'netflix', amountCents: -1799 }));
    await renderPage({ transactions: [...seed.transactions, ...netflix] });
    const sub = await openFilter(user, 'Recurring');
    await user.click(await within(sub).findByRole('menuitemcheckbox', { name: /Netflix/ }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(3));
  });

  it('combines kinds and clears them all', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(await openFilter(user, 'Account')).getByRole('menuitemcheckbox', { name: /Amex/ }));
    await user.click(within(await openFilter(user, 'Review status')).getByRole('menuitemcheckbox', { name: 'Not reviewed' }));
    await waitFor(() => expect(screen.queryByRole('grid', { name: 'Transactions' })).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(listNames()).toEqual(['whole', 'shell']));
  });

  it('shows month headers with totals only while filtering', async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(screen.queryByRole('heading', { name: /November 2026/ })).not.toBeInTheDocument();
    const sub = await openFilter(user, 'Review status');
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: 'Not reviewed' }));
    const month = await screen.findByRole('heading', { name: /November 2026/ });
    expect(month).toHaveTextContent('$48.00');
  });

  it('keeps filters when coming back to the screen', async () => {
    setIpc(createMemoryIpc(seed));
    useTransactionsStore.setState({ transactions: [], filter: { reviewed: false }, sort: 'newest', selected: new Set(), cursor: 0, focused: null });
    useProfileStore.setState({ profiles: [], activeProfileId: null });
    render(<TransactionsPage />);
    await waitFor(() => expect(listNames()).toEqual(['shell']));
    expect(screen.getByRole('button', { name: 'Remove Not reviewed filter' })).toBeInTheDocument();
  });

  it('says no matches when a filter finds nothing', async () => {
    const user = userEvent.setup();
    await renderPage();
    const sub = await openFilter(user, 'Keywords');
    await user.type(within(sub).getByRole('textbox', { name: 'Keyword' }), 'zzz{Enter}');
    expect(await screen.findByText('No transactions match these filters.')).toBeInTheDocument();
  });

  it('ignores list shortcuts while the filter menu is open', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.keyboard('x');
    expect(useTransactionsStore.getState().selected.size).toBe(0);
  });

  it('ignores list shortcuts while a dialog is open', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(details()).getByRole('button', { name: 'Make recurring' }));
    await screen.findByRole('dialog', { name: 'New recurring' });
    await user.keyboard('x');
    expect(useTransactionsStore.getState().selected.size).toBe(0);
  });

  it('closes a submenu, then the menu, with Escape', async () => {
    const user = userEvent.setup();
    await renderPage();
    await openFilter(user, 'Category');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Category' })).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Filters' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it('sorts by amount from the Sort menu', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Sort' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Sort by amount (low to high)' }));
    expect(listNames()).toEqual(['shell', 'whole']);
    expect(useTransactionsStore.getState().sort).toBe('amountAsc');
  });

  it('reveals search from the toolbar and filters as you type', async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(screen.queryByLabelText('Search transactions')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.type(screen.getByLabelText('Search transactions'), 'shell');
    await waitFor(() => expect(listNames()).toEqual(['shell']));
  });

  it('selects all with the header checkbox and offers bulk review', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    await waitFor(() => expect(useTransactionsStore.getState().transactions.every((t) => t.reviewed)).toBe(true));
  });

  it('sets one category on the selected transactions', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Set category' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'fue{Enter}');
    await waitFor(() => expect(useTransactionsStore.getState().transactions.every((t) => t.categoryId === 20)).toBe(true));
    expect(useTransactionsStore.getState().selected.size).toBe(0);
    expect(screen.queryByRole('dialog', { name: 'Choose category' })).not.toBeInTheDocument();
  });

  it('keeps the bulk bar compact: review and clear are icon buttons with tooltips', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveTextContent('');
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveAttribute('title', 'Mark reviewed');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByText('2 selected')).not.toBeInTheDocument();
  });

  it('changes the type of selected transactions', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Set type' }));
    await user.click(screen.getByRole('menuitem', { name: 'Internal transfer' }));
    await waitFor(() => expect(useTransactionsStore.getState().transactions.every((t) => t.txType === 'transfer')).toBe(true));
  });

  it('selects with X and shows the selection count', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.keyboard('x');
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
  });

  it('highlights the row shown in the detail panel, and arrow keys move both', async () => {
    const user = userEvent.setup();
    await renderPage();
    expect(within(list()).getByRole('row', { current: true })).toHaveTextContent('Whole Foods');
    await user.keyboard('{ArrowDown}');
    expect(within(details()).getByRole('heading', { name: 'Shell' })).toBeInTheDocument();
    expect(within(list()).getByRole('row', { current: true })).toHaveTextContent('Shell');
  });
});

describe('TransactionsPage tags', () => {
  const tags = [
    { id: 1, name: 'Work', color: '#4a8ef0' },
    { id: 2, name: 'Vacation 2026', color: '#e5484d' },
    { id: 3, name: 'Gift', color: '#5cb85c' },
  ];
  async function renderTagged() {
    setIpc(
      createMemoryIpc({
        sources,
        tags,
        transactions: [
          tx({ id: 1, postedOn: '2026-11-15', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -6418, categoryId: 10, reviewed: true, tagIds: [1, 2, 3] }),
          tx({ id: 2, postedOn: '2026-11-10', description: 'SHELL OIL', merchant: 'shell', amountCents: -4800, sourceId: 2 }),
        ],
      }),
    );
    useTransactionsStore.setState({ transactions: [], filter: {}, sort: 'newest', selected: new Set(), cursor: 0, focused: null });
    useProfileStore.setState({ profiles: [], activeProfileId: null });
    render(<TransactionsPage />);
    await screen.findByRole('row', { name: /Whole Foods/ });
  }
  const rowOf = (name: RegExp) => within(list()).getByRole('row', { name });

  it('shows up to two tag pills on a row, then +N', async () => {
    await renderTagged();
    const row = rowOf(/Whole Foods/);
    expect(within(row).getByText('Work')).toBeInTheDocument();
    expect(within(row).getByText('Vacation 2026')).toBeInTheDocument();
    expect(within(row).queryByText('Gift')).not.toBeInTheDocument();
    expect(within(row).getByText('+1')).toBeInTheDocument();
  });

  it('filters by a tag from the Tags submenu', async () => {
    const user = userEvent.setup();
    await renderTagged();
    await user.click(screen.getByRole('button', { name: 'Filter' }));
    await user.click(within(screen.getByRole('menu', { name: 'Filters' })).getByRole('menuitem', { name: 'Tags' }));
    const sub = await screen.findByRole('menu', { name: 'Tags' });
    await user.type(within(sub).getByRole('textbox', { name: 'Search Tags' }), 'vac');
    expect(within(sub).queryByRole('menuitemcheckbox', { name: 'Work' })).not.toBeInTheDocument();
    await user.click(within(sub).getByRole('menuitemcheckbox', { name: 'Vacation 2026' }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Remove Vacation 2026 filter' })).toBeInTheDocument();
  });

  it('tags selected rows from the bulk Tag action, removing when all have it', async () => {
    const user = userEvent.setup();
    await renderTagged();
    await user.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Tag' }));
    const picker = await screen.findByRole('dialog', { name: 'Tags' });
    // Work is on one of the two rows: shown as mixed.
    expect(within(picker).getByRole('checkbox', { name: 'Work' })).toHaveAttribute('aria-checked', 'mixed');
    await user.click(within(picker).getByRole('checkbox', { name: 'Work' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(2)?.tagIds).toEqual([1]));
    expect(within(picker).getByRole('checkbox', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
    await user.click(within(picker).getByRole('checkbox', { name: 'Work' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(2)?.tagIds).toEqual([]));
    expect(useTransactionsStore.getState().byId(1)?.tagIds).toEqual([2, 3]);
  });

  it('shows the tags in the detail panel and adds one from Add tag', async () => {
    const user = userEvent.setup();
    await renderTagged();
    await user.click(rowOf(/Shell/));
    const section = within(details()).getByRole('group', { name: 'Tags' });
    await user.click(within(section).getByRole('button', { name: 'Add tag' }));
    const picker = await screen.findByRole('dialog', { name: 'Tags' });
    await user.click(within(picker).getByRole('checkbox', { name: 'Gift' }));
    await waitFor(() => expect(within(picker).getByRole('checkbox', { name: 'Gift' })).toHaveAttribute('aria-checked', 'true'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Tags' })).not.toBeInTheDocument();
    expect(within(section).getByText('Gift')).toBeInTheDocument();
    expect(useTransactionsStore.getState().byId(2)?.reviewed).toBe(false);
  });

  it('keeps list shortcuts quiet while the tag picker has focus', async () => {
    const user = userEvent.setup();
    await renderTagged();
    const section = within(details()).getByRole('group', { name: 'Tags' });
    await user.click(within(section).getByRole('button', { name: 'Add tag' }));
    const picker = await screen.findByRole('dialog', { name: 'Tags' });
    await user.click(within(picker).getByRole('checkbox', { name: 'Gift' }));
    await user.keyboard('x');
    await user.keyboard('{ArrowDown}');
    expect(useTransactionsStore.getState().selected.size).toBe(0);
    expect(within(details()).getByRole('heading', { name: 'Whole Foods' })).toBeInTheDocument();
  });
});


describe('TransactionsPage deleting', () => {
  it('deletes the selected transactions after a confirm that says how many', async () => {
    const user = userEvent.setup();
    await renderPage();
    for (const cb of within(list()).getAllByRole('checkbox')) await user.click(cb);
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete 2 transactions?' });
    expect(dialog).toHaveTextContent('categories, notes and tags');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryAllByRole('row')).toHaveLength(0));
  });

  it('cancelling keeps them', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(list()).getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: 'Delete selected' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(list()).getAllByRole('row')).toHaveLength(2);
  });

  it('deletes one transaction from its detail pane', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(details()).getByRole('button', { name: 'Delete transaction' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete this transaction?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(within(list()).getAllByRole('row')).toHaveLength(1));
  });

});
