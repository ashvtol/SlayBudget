import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { RecurringPage } from '@/features/analytics/recurring-page';
import { DetailPane } from '@/features/transactions/detail-pane';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { useNavStore } from '@/lib/stores/nav-store';

afterEach(() => cleanup());

let nextId = 1;
const claude = (postedOn: string, cents: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'ANTHROPIC* CLAUDE SUSAN FRANCISCO CA', merchant: 'anthropic claude',
  amountCents: -cents, currency: 'USD', categoryId: 10, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const sources: Source[] = [{ id: 1, profileId: 1, name: 'Visa', kind: 'csv', institution: null, currency: 'USD' }];
/** Claude at $22.11 on the 5th since June, then $100.18 on Nov 21 (the upgrade). Returns the upgrade's id. */
function seed() {
  nextId = 1;
  const steady = [6, 7, 8, 9, 10, 11].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
  const upgrade = claude('2026-11-21', 10018);
  setIpc(createMemoryIpc({ sources, transactions: [...steady, upgrade] }));
  return upgrade.id;
}

async function renderDetail(id: number) {
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, moveNote: null });
  await useTransactionsStore.getState().load(null);
  render(<DetailPane id={id} onClose={() => {}} onPickCategory={() => {}} />);
}

async function renderRecurrings() {
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-22' });
  render(<RecurringPage />);
  await screen.findByRole('region', { name: 'Recurring summary' });
}

const box = () => screen.findByRole('region', { name: 'Possible new price' });

describe('the "new price?" box in the transaction detail', () => {
  it('asks with the old and new price, and "Yes, new price" joins the bill', async () => {
    const user = userEvent.setup();
    const upgrade = seed();
    await renderDetail(upgrade);
    const b = await box();
    expect(b).toHaveTextContent('Is this Anthropic Claude at a new price?');
    expect(b).toHaveTextContent('It was $22.11, this is $100.18 (+353%).');
    await user.click(within(b).getByRole('button', { name: 'Yes, new price' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Possible new price' })).not.toBeInTheDocument());
    expect(await screen.findByTestId('recurring-name')).toHaveTextContent('Anthropic Claude');
    expect(await ipc().undoState()).toEqual({ undo: 'New Price', redo: null });
  });

  it('"No, a one-off" just closes it', async () => {
    const user = userEvent.setup();
    const upgrade = seed();
    await renderDetail(upgrade);
    await user.click(within(await box()).getByRole('button', { name: 'No, a one-off' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Possible new price' })).not.toBeInTheDocument());
    expect(await ipc().priceChecks()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Make recurring' })).toBeInTheDocument();
  });

  it('"A separate subscription" opens the new recurring form, prefilled', async () => {
    const user = userEvent.setup();
    const upgrade = seed();
    await renderDetail(upgrade);
    await user.click(within(await box()).getByRole('button', { name: 'A separate subscription' }));
    const form = await screen.findByRole('dialog', { name: 'New recurring' });
    expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Anthropic Claude');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await ipc().listRecurring(null)).length).toBe(2));
  });
});

describe('price changes on the Recurrings page', () => {
  it('asks from the bill too, then shows "Price went up" on the bill and its price history', async () => {
    const user = userEvent.setup();
    seed();
    await renderRecurrings();
    const details = screen.getByRole('region', { name: 'Details' });
    const b = await within(details).findByRole('region', { name: 'Possible new price' });
    expect(b).toHaveTextContent('Nov 21');
    await user.click(within(b).getByRole('button', { name: 'Yes, new price' }));
    // A green arrow beside the category tag; the name and frequency keep their room.
    const arrow = await screen.findByRole('img', { name: 'Price went up' });
    const row = screen.getByRole('listitem', { name: /Anthropic Claude/ });
    expect(arrow.closest('li')).toBe(row);
    expect(arrow).toHaveTextContent('↑');
    expect(within(row).queryByText('Price went up')).not.toBeInTheDocument();
    const pill = within(row).getByText('Groceries');
    expect(pill.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const d = screen.getByRole('region', { name: 'Details' });
    expect(await within(d).findByText('Price went up: $22.11 → $100.18')).toBeInTheDocument();
    const history = await within(d).findByRole('list', { name: 'Price history' });
    expect(within(history).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Nov 21, 2026$22.11 → $100.18']);
  });

  it('a drop says "Price went down"', async () => {
    const user = userEvent.setup();
    nextId = 1;
    const steady = [6, 7, 8, 9, 10, 11].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    setIpc(createMemoryIpc({ sources, transactions: [...steady, claude('2026-11-20', 1000)] }));
    await renderRecurrings();
    await user.click(within(await screen.findByRole('region', { name: 'Possible new price' })).getByRole('button', { name: 'Yes, new price' }));
    expect(await within(screen.getByRole('region', { name: 'Details' })).findByText('Price went down: $22.11 → $10.00')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Price went down' })).toHaveTextContent('↓');
  });

  it('suggests merging look-alike bills; Merge keeps one, Not the same stops asking', async () => {
    const user = userEvent.setup();
    seed();
    await ipc().createRecurring({
      name: 'Anthropic Claude Max', categoryId: null, matchKind: 'contains', pattern: 'anthropic claude',
      minCents: 2000, maxCents: 12022, frequency: 'monthly', dayOfMonth: null,
    });
    await renderRecurrings();
    const s = await screen.findByRole('region', { name: 'Same subscription?' });
    expect(s).toHaveTextContent('Anthropic Claude and Anthropic Claude Max look like the same subscription. Merge them?');
    await user.click(within(s).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByText('Merged into Anthropic Claude.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Same subscription?' })).not.toBeInTheDocument();
    expect((await ipc().listRecurring(null)).length).toBe(1);
    await ipc().undo();
    cleanup();
    await renderRecurrings();
    await user.click(within(await screen.findByRole('region', { name: 'Same subscription?' })).getByRole('button', { name: 'Not the same' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Same subscription?' })).not.toBeInTheDocument());
    expect((await ipc().listRecurring(null)).length).toBe(2);
  });

  it('an ⓘ on a merge suggestion compares the two bills side by side, and × closes it', async () => {
    const user = userEvent.setup();
    seed();
    await ipc().createRecurring({
      name: 'Anthropic Claude Max', categoryId: null, matchKind: 'contains', pattern: 'anthropic claude',
      minCents: 2000, maxCents: 12022, frequency: 'monthly', dayOfMonth: null,
    });
    await renderRecurrings();
    const s = await screen.findByRole('region', { name: 'Same subscription?' });
    await user.click(within(s).getByRole('button', { name: 'Compare Anthropic Claude and Anthropic Claude Max' }));
    const table = within(s).getByRole('table', { name: 'Anthropic Claude and Anthropic Claude Max side by side' });
    const row = (label: string) => within(table).getByRole('row', { name: new RegExp(`^${label}`) });
    expect(row('Matches')).toHaveTextContent('Contains "anthropic claude"');
    expect(row('Amount')).toHaveTextContent('$20.00 to $120.22');
    expect(row('Frequency')).toHaveTextContent('Monthly');
    expect(row('Charges')).toBeInTheDocument();
    expect(row('Last charge')).toBeInTheDocument();
    await user.click(within(s).getByRole('button', { name: 'Close comparison' }));
    expect(within(s).queryByRole('table')).not.toBeInTheDocument();
  });

  it('three look-alike bills make one suggestion; Merge joins all three, Not the same stops asking about any of them', async () => {
    const user = userEvent.setup();
    seed();
    const rule = { name: 'Anthropic Claude', categoryId: null, matchKind: 'merchant' as const, pattern: 'anthropic claude', minCents: 2000, maxCents: 12022, dayOfMonth: null };
    // seed() already has a monthly Anthropic Claude bill; two more copies make three.
    await ipc().createRecurring({ ...rule, frequency: 'yearly' });
    await ipc().createRecurring({ ...rule, frequency: 'biennial' });
    await renderRecurrings();
    const s = await screen.findByRole('region', { name: 'Same subscription?' });
    expect(within(s).getAllByRole('button', { name: 'Merge' })).toHaveLength(1);
    expect(s).toHaveTextContent('3 bills look like the same subscription: Anthropic Claude. Merge them?');
    await user.click(within(s).getByRole('button', { name: 'Compare the 3 Anthropic Claude bills' }));
    const table = within(s).getByRole('table');
    expect(within(table).getByRole('row', { name: /^Frequency/ })).toHaveTextContent('MonthlyAnnuallyEvery 2 years');
    await user.click(within(s).getByRole('button', { name: 'Merge' }));
    expect(await screen.findByText('Merged into Anthropic Claude.')).toBeInTheDocument();
    expect((await ipc().listRecurring(null)).filter((r) => r.saved).length).toBe(1);
    await ipc().undo();
    await ipc().undo();
    cleanup();
    await renderRecurrings();
    expect((await ipc().listRecurring(null)).filter((r) => r.saved).length).toBe(3);
    await user.click(within(await screen.findByRole('region', { name: 'Same subscription?' })).getByRole('button', { name: 'Not the same' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Same subscription?' })).not.toBeInTheDocument());
  });

  it("a bill's charges show their full date on one line, and clicking one opens that transaction", async () => {
    const user = userEvent.setup();
    seed();
    await renderRecurrings();
    const charges = await within(screen.getByRole('region', { name: 'Details' })).findByRole('list', { name: 'Charges' });
    const june = within(charges).getByRole('button', { name: /Open ANTHROPIC.* Jun 5, 2026/ });
    expect(june).toHaveTextContent('Jun 5, 2026');
    expect(within(june).getByText('Jun 5, 2026')).toHaveClass('whitespace-nowrap');
    await user.click(june);
    await waitFor(() => expect(useNavStore.getState().section).toBe('transactions'));
    expect(useTransactionsStore.getState().focused).toBe(1);
  });

  it('shows an arrow when the latest charge is 10% or more off the one before, even inside the bill\'s range', async () => {
    nextId = 1;
    const steady = [6, 7, 8, 9, 10].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    setIpc(createMemoryIpc({ sources, transactions: [...steady, claude('2026-11-05', 1700)] }));
    await renderRecurrings();
    const row = await screen.findByRole('listitem', { name: 'Anthropic Claude' });
    expect(within(row).getByRole('img', { name: 'Price went down' })).toHaveTextContent('↓');
    expect(within(row).getByRole('img', { name: 'Price went down' }).style.color).toBe('var(--neg)');
    expect(row).toHaveTextContent('$17.00');
    expect(row).not.toHaveTextContent('$22.11');
    expect(within(screen.getByRole('region', { name: 'Details' })).getByText('Price went down: $22.11 → $17.00')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Possible new price' })).not.toBeInTheDocument();
  });

  it('shows no arrow for a small wobble', async () => {
    nextId = 1;
    const steady = [6, 7, 8, 9, 10].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    setIpc(createMemoryIpc({ sources, transactions: [...steady, claude('2026-11-05', 2100)] }));
    await renderRecurrings();
    const row = await screen.findByRole('listitem', { name: 'Anthropic Claude' });
    expect(within(row).queryByRole('img', { name: /Price went/ })).not.toBeInTheDocument();
  });

  it('suggests merging a subscription whose statement name changed', async () => {
    nextId = 1;
    const row = (postedOn: string, description: string, cents: number): Transaction => ({
      ...claude(postedOn, cents), description, merchant: description.toLowerCase(),
    });
    const old = [1, 2, 3, 4, 5].map((m) => row(`2026-0${m}-22`, 'WMT PLUS', 1427));
    const renamed = [6, 7, 8, 9, 10].map((m) => row(`2026-${String(m).padStart(2, '0')}-22`, 'WALMART+ MEMBER', 1428));
    setIpc(createMemoryIpc({ sources, transactions: [...old, ...renamed] }));
    await renderRecurrings();
    const s = await screen.findByRole('region', { name: 'Same subscription?' });
    expect(s).toHaveTextContent('Wmt Plus and Walmart+ Member look like the same subscription. Merge them?');
  });

  it('merging a renamed bill records no price change where the name changed', async () => {
    nextId = 1;
    const old = [1, 2, 3, 4, 5].map((m) => ({ ...claude(`2026-0${m}-05`, 2207), description: 'CLAUDE.AI SUBSCRIPTISAN', merchant: 'claude.ai subscriptisan' }));
    const steady = [6, 7, 8, 9, 10, 11].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    const upgrade = claude('2026-11-21', 10018);
    setIpc(createMemoryIpc({ sources, transactions: [...old, ...steady, upgrade] }));
    const bills = (await ipc().listRecurring(null)).filter((b) => b.saved);
    const id = (p: string) => bills.find((b) => b.saved!.pattern === p)!.saved!.id;
    const check = (await ipc().priceChecks()).find((c) => c.txId === upgrade.id)!;
    await ipc().answerPriceCheck(check.id, 'new_price');
    await ipc().mergeRecurrings(id('claude.ai subscriptisan'), id('anthropic claude'));
    const history = await ipc().priceHistory(id('claude.ai subscriptisan'));
    expect(history).toEqual([{ changedOn: '2026-11-21', fromCents: 2211, toCents: 10018 }]);
  });

  it('an ⓘ on the new-price question shows the charge as the statement has it, and × closes it', async () => {
    const user = userEvent.setup();
    nextId = 1;
    const steady = [6, 7, 8, 9, 10].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    setIpc(createMemoryIpc({ sources, transactions: [...steady, claude('2026-11-20', 1000)] }));
    await renderRecurrings();
    const box = await screen.findByRole('region', { name: 'Possible new price' });
    await user.click(within(box).getByRole('button', { name: /^Statement details for ANTHROPIC/ }));
    expect(within(box).getByText('Appears on statement as')).toBeInTheDocument();
    expect(within(box).getByText('ANTHROPIC* CLAUDE SUSAN FRANCISCO CA')).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Close statement details' }));
    expect(within(box).queryByText('Appears on statement as')).not.toBeInTheDocument();
  });

  it('shows a green arrow up when the latest charge rose 10% or more', async () => {
    nextId = 1;
    const steady = [6, 7, 8, 9, 10].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    setIpc(createMemoryIpc({ sources, transactions: [...steady, claude('2026-11-05', 2700)] }));
    await renderRecurrings();
    const row = await screen.findByRole('listitem', { name: 'Anthropic Claude' });
    const up = within(row).getByRole('img', { name: 'Price went up' });
    expect(up).toHaveTextContent('↑');
    expect(up.style.color).toBe('var(--pos)');
  });
});
