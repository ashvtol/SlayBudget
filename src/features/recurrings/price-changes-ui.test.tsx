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

afterEach(() => cleanup());

let nextId = 1;
const claude = (postedOn: string, cents: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'ANTHROPIC* CLAUDE SUSAN FRANCISCO CA', merchant: 'anthropic claude',
  amountCents: -cents, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
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
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, sourcesById: {}, selected: new Set(), cursor: 0, offer: null, notice: null });
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
    const badge = await screen.findByText('Price went up');
    expect(badge.closest('li')).toBe(screen.getByRole('listitem', { name: /Anthropic Claude/ }));
    const d = screen.getByRole('region', { name: 'Details' });
    expect(await within(d).findByText('Price went up: $22.11 → $100.18')).toBeInTheDocument();
    const history = within(d).getByRole('list', { name: 'Price history' });
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
});
