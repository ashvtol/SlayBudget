import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';
import { RecurringPage } from './recurring-page';

afterEach(() => cleanup());

let nextId = 1;
const tx = (merchant: string, postedOn: string, amountCents: number, sourceId = 1): Transaction => ({
  id: nextId++, profileId: 1, sourceId, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const sources: Source[] = [
  { id: 1, profileId: 1, name: 'Amex Gold', kind: 'csv', institution: null, currency: 'USD' },
  { id: 3, profileId: 1, name: 'Citi Checking', kind: 'pdf', institution: null, currency: 'USD' },
];

async function setup() {
  setIpc(createMemoryIpc({
    sources,
    transactions: [
      tx('rent', '2026-09-01', -220000, 3), tx('rent', '2026-10-01', -220000, 3), tx('rent', '2026-11-01', -220000, 3),
      tx('netflix', '2026-08-28', -1799), tx('netflix', '2026-09-28', -1799), tx('netflix', '2026-10-28', -1799),
    ],
  }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21' });
  render(<RecurringPage />);
  await screen.findByRole('region', { name: 'Recurring summary' });
}

const details = () => screen.getByRole('region', { name: 'Details' });

describe('RecurringPage', () => {
  it('summarises left to pay and paid so far this month', async () => {
    await setup();
    const summary = screen.getByRole('region', { name: 'Recurring summary' });
    expect(summary).toHaveTextContent('$18left to pay');
    expect(summary).toHaveTextContent('$2,200paid so far');
    expect(within(summary).getByRole('img', { name: 'Paid vs due this month' })).toBeInTheDocument();
  });

  it('lists this month with date, name, frequency, amount and paid state', async () => {
    await setup();
    const rows = within(screen.getByRole('list', { name: 'This month' })).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/^Nov 1st.*Rent.*Monthly.*\$2,200\.00/),
      expect.stringMatching(/^Nov 28th.*Netflix.*Monthly.*\$17\.99/),
    ]);
    expect(within(rows[0]).getByRole('img', { name: 'Paid' })).toBeInTheDocument();
    expect(within(rows[1]).queryByRole('img', { name: 'Paid' })).not.toBeInTheDocument();
  });

  it('details the first bill: next payment, rules, history, metrics, account and charges', async () => {
    await setup();
    const d = details();
    expect(within(d).getByRole('heading', { name: 'Rent' })).toBeInTheDocument();
    expect(d).toHaveTextContent('Next payment$2,200.00around Dec 1st');
    const rules = within(d).getByRole('list', { name: 'Rules' });
    expect(rules).toHaveTextContent('Named Rent');
    expect(rules).toHaveTextContent('from $1,430 to $2,970');
    expect(rules).toHaveTextContent('on the 1st');
    expect(rules).toHaveTextContent('every month');
    const history = within(d).getByRole('list', { name: 'Payment history' });
    expect(within(history).getByLabelText('Nov: paid')).toBeInTheDocument();
    expect(within(history).getByLabelText('Dec: upcoming')).toBeInTheDocument();
    expect(within(d).getByRole('table', { name: 'Key metrics' })).toHaveTextContent('$6,600.00');
    expect(d).toHaveTextContent('Citi Checking');
    expect(within(within(d).getByRole('list', { name: 'Charges' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows another bill when selected', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(within(screen.getByRole('list', { name: 'This month' })).getByText('Netflix'));
    expect(within(details()).getByRole('heading', { name: 'Netflix' })).toBeInTheDocument();
  });

  it('says so when nothing recurring is found', async () => {
    setIpc(createMemoryIpc({ sources, transactions: [] }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    expect(await screen.findByText(/No recurring charges detected yet/)).toBeInTheDocument();
  });

  it('lists bills due after this month under In the future', async () => {
    setIpc(createMemoryIpc({
      sources,
      transactions: [tx('domain', '2024-01-05', -1500), tx('domain', '2025-01-05', -1500), tx('domain', '2026-01-05', -1500)],
    }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    const future = await screen.findByRole('list', { name: 'In the future' });
    expect(future).toHaveTextContent(/Jan 5th.*Domain.*Annually.*\$15\.00/);
  });

  it('does not treat card payments in excluded categories as bills', async () => {
    const pay = (postedOn: string) => ({ ...tx('amex payment', postedOn, -185000, 3), categoryId: 99 });
    setIpc(createMemoryIpc({
      sources,
      categories: [{ id: 99, groupId: 1, name: 'Card Payment', emoji: null, color: null, budgetCents: null, excluded: true, kind: 'transfer', sortOrder: 0, archived: false }],
      transactions: [pay('2026-09-20'), pay('2026-10-20'), pay('2026-11-20'), tx('rent', '2026-09-01', -220000, 3), tx('rent', '2026-10-01', -220000, 3), tx('rent', '2026-11-01', -220000, 3)],
    }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    const list = await screen.findByRole('list', { name: 'This month' });
    expect(list).toHaveTextContent('Rent');
    expect(list).not.toHaveTextContent('Amex Payment');
  });

  it("colors a bill's category pill with its group color when the category has none", async () => {
    const t = (postedOn: string) => ({ ...tx('whole foods', postedOn, -5000), categoryId: 10 });
    setIpc(createMemoryIpc({ sources, transactions: [t('2026-09-15'), t('2026-10-15'), t('2026-11-15')] }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    const list = await screen.findByRole('list', { name: 'This month' });
    expect(within(list).getByRole('button', { name: /Groceries/ }).style.background).toContain('rgb(255, 149, 0)');
  });

  it('shows bills that stopped arriving under Not seen lately', async () => {
    setIpc(createMemoryIpc({
      sources,
      transactions: [tx('geico auto', '2026-04-03', -14200), tx('geico auto', '2026-05-03', -14200), tx('geico auto', '2026-06-03', -14200)],
    }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    const stale = await screen.findByRole('list', { name: 'Not seen lately' });
    expect(stale).toHaveTextContent(/GEICO.*Monthly.*\$142\.00/);
    expect(stale).toHaveTextContent('Last Jun 3rd');
  });

  it('dates stopped bills from another year in full and says when nothing is due this month', async () => {
    setIpc(createMemoryIpc({
      sources,
      transactions: [tx('walmart+', '2025-03-22', -1427), tx('walmart+', '2025-04-22', -1427), tx('walmart+', '2025-05-22', -1427)],
    }));
    useAnalyticsStore.setState({ today: '2026-11-21' });
    render(<RecurringPage />);
    const stale = await screen.findByRole('list', { name: 'Not seen lately' });
    expect(stale).toHaveTextContent('Last May 22, 2025');
    expect(screen.getByText('Nothing due this month.')).toBeInTheDocument();
  });
});

describe('RecurringPage management', () => {
  const thisMonth = () => screen.getByRole('list', { name: 'This month' });
  const openActions = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Recurring actions' }));

  it('pauses a bill into Paused and activates it again', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Pause' }));
    const paused = await screen.findByRole('list', { name: 'Paused' });
    expect(paused).toHaveTextContent('Rent');
    expect(thisMonth()).not.toHaveTextContent('Rent');
    await user.click(within(paused).getByText('Rent'));
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Activate' }));
    expect(await within(thisMonth()).findByText('Rent')).toBeInTheDocument();
  });

  it('archives a bill', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await user.click(await screen.findByRole('button', { name: /Archived/ }));
    expect(screen.getByRole('list', { name: 'Archived' })).toHaveTextContent('Rent');
  });

  it('deletes a bill after confirming; it comes back as a suggestion', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    const dialog = screen.getByRole('alertdialog', { name: /Delete Rent/ });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('list', { name: 'Suggestions' })).toHaveTextContent('Rent');
    expect(thisMonth()).not.toHaveTextContent('Rent');
  });

  it('adds or dismisses a suggestion', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    const suggestions = await screen.findByRole('list', { name: 'Suggestions' });
    await user.click(within(suggestions).getByRole('button', { name: 'Add Rent' }));
    expect(await within(thisMonth()).findByText('Rent')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Suggestions' })).not.toBeInTheDocument();
  });

  it('edits the rules and says what changed', async () => {
    const user = userEvent.setup();
    await setup();
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    const form = screen.getByRole('dialog', { name: 'Edit recurring' });
    const max = within(form).getByRole('textbox', { name: 'Maximum amount' });
    await user.clear(max);
    await user.type(max, '2000');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('3 transactions no longer match.');
    expect(within(details()).getByRole('list', { name: 'Rules' })).toHaveTextContent('to $2,000');
  });

  it('creates a bill from a searched transaction', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Add recurring' }));
    const picker = screen.getByRole('dialog', { name: 'New recurring' });
    await user.type(within(picker).getByRole('textbox', { name: 'Search transactions' }), 'ren');
    await user.click(await within(picker).findByRole('button', { name: /Rent/ }));
    expect(await within(picker).findByText(/Matches 3 transactions/)).toBeInTheDocument();
    await user.click(within(picker).getByRole('button', { name: 'Save' }));
    expect(await within(thisMonth()).findByText('Rent')).toBeInTheDocument();
  });

describe('RecurringPage actions menu', () => {
  const openActions = async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Recurring actions' }));

  it('closes the menu with Escape or a click elsewhere', async () => {
    const user = userEvent.setup();
    await setup();
    await openActions(user);
    expect(screen.getByRole('menu', { name: 'Recurring actions' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Recurring actions' })).not.toBeInTheDocument();
    await openActions(user);
    await user.click(document.body);
    expect(screen.queryByRole('menu', { name: 'Recurring actions' })).not.toBeInTheDocument();
  });

  it('says so when an action fails', async () => {
    const user = userEvent.setup();
    await setup();
    ipc().setRecurringStatus = async () => {
      throw new Error('database is locked');
    };
    await openActions(user);
    await user.click(screen.getByRole('menuitem', { name: 'Pause' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't do that: database is locked");
  });
});

});
