import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Source, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { RecurringPage } from '@/features/analytics/recurring-page';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';

afterEach(() => cleanup());

let nextId = 1;
const row = (postedOn: string, description: string, merchant: string, amountCents: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description, merchant, amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const sources: Source[] = [{ id: 1, profileId: 1, name: 'Amex', kind: 'csv', institution: null, currency: 'USD' }];
const MONTHS = ['06', '07', '08', '09', '10'];

/** Walmart+ on the 22nd since June, each paid back by an Amex Platinum credit (Sep's lands two days later). */
async function seed(paidBack: boolean) {
  nextId = 1;
  const charges = MONTHS.map((m) => row(`2026-${m}-22`, 'WALMART+ MEMBER', 'walmart+ member', -1428));
  const credits = MONTHS.map((m) => row(`2026-${m}-${m === '09' ? '24' : '22'}`, 'PLATINUM WALMART+ CREDIT', 'platinum walmart+', 1428));
  setIpc(createMemoryIpc({ sources, transactions: [...charges, ...credits] }));
  const bills = await ipc().listRecurring(null);
  const id = bills.find((b) => b.saved?.pattern === 'walmart+ member')!.saved!.id;
  if (paidBack) await ipc().setRecurringPaidBackBy(id, ['platinum walmart+']);
  return { id, charges, credits };
}

async function renderRecurrings() {
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-15' });
  render(<RecurringPage />);
  await screen.findByRole('region', { name: 'Recurring summary' });
}
const details = () => screen.getByRole('region', { name: 'Details' });

describe('bills that are paid back', () => {
  it('show each charge with its credit, say it was fully credited, and what it cost you', async () => {
    const user = userEvent.setup();
    const { credits } = await seed(true);
    await renderRecurrings();
    const listRow = screen.getByRole('listitem', { name: 'Walmart+ Member' });
    expect(within(listRow).getByText('Credited')).toBeInTheDocument();
    await user.click(listRow);
    expect(within(details()).getByText('Fully credited')).toBeInTheDocument();
    expect(within(details()).getByRole('list', { name: 'Rules' })).toHaveTextContent('Paid back by Platinum Walmart+');
    const metrics = within(details()).getByRole('table', { name: 'Key metrics' });
    expect(within(metrics).getByRole('row', { name: /^2026/ })).toHaveTextContent('$71.40$14.28$71.40$0.00');
    const charges = within(details()).getByRole('list', { name: 'Charges' });
    const sep = within(charges).getByRole('button', { name: 'Open the credit for Sep 22, 2026: Sep 24, 2026' });
    expect(sep).toHaveTextContent('Credited $14.28 on Sep 24, 2026');
    await user.click(sep);
    await waitFor(() => expect(useNavStore.getState().section).toBe('transactions'));
    expect(useTransactionsStore.getState().focused).toBe(credits[3].id);
  });

  it('suggest linking credits that match, and stop asking after No', async () => {
    const user = userEvent.setup();
    const { id } = await seed(false);
    await renderRecurrings();
    const ask = await screen.findByRole('region', { name: 'Paid back?' });
    expect(ask).toHaveTextContent('Credits from Platinum Walmart+ match 5 Walmart+ Member charges. Do they pay it back?');
    await user.click(within(ask).getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Paid back?' })).not.toBeInTheDocument());
    expect((await ipc().listRecurring(null)).find((b) => b.saved?.id === id)!.saved!.paidBackBy).toEqual(['platinum walmart+']);
    await ipc().setRecurringPaidBackBy(id, null);
    cleanup();
    await renderRecurrings();
    await user.click(within(await screen.findByRole('region', { name: 'Paid back?' })).getByRole('button', { name: 'No' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Paid back?' })).not.toBeInTheDocument());
    expect((await ipc().listRecurring(null)).find((b) => b.saved?.id === id)!.saved!.paidBackBy).toEqual([]);
  });

  it('can be set in the rules, with other names the bill goes by', async () => {
    const user = userEvent.setup();
    const { id } = await seed(false);
    await ipc().setRecurringPaidBackBy(id, []);
    await renderRecurrings();
    await user.click(screen.getByRole('listitem', { name: 'Walmart+ Member' }));
    await user.click(screen.getByRole('button', { name: 'Edit rules' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit recurring' });
    await user.type(within(dialog).getByLabelText('Also matches'), 'wmt plus, walmart.com w+');
    await user.type(within(dialog).getByLabelText('Paid back by'), 'Platinum Walmart+');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = (await ipc().listRecurring(null)).find((b) => b.saved?.id === id)!.saved!;
    expect(saved.alsoMatches).toEqual(['wmt plus', 'walmart.com w+']);
    expect(saved.paidBackBy).toEqual(['platinum walmart+']);
    expect(await within(details()).findByText('Fully credited')).toBeInTheDocument();
  });

  it('an ⓘ on the suggestion lists each charge with the credit that matched it, and × closes it', async () => {
    const user = userEvent.setup();
    await seed(false);
    await renderRecurrings();
    const ask = await screen.findByRole('region', { name: 'Paid back?' });
    await user.click(within(ask).getByRole('button', { name: 'Show the charges and credits for Walmart+ Member' }));
    const table = within(ask).getByRole('table', { name: 'Walmart+ Member charges and Platinum Walmart+ credits' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Oct 22, 2026$14.28Oct 22, 2026$14.28Full');
    expect(rows[1]).toHaveTextContent('Sep 22, 2026$14.28Sep 24, 2026$14.28Full');
    await user.click(within(ask).getByRole('button', { name: 'Close' }));
    expect(within(ask).queryByRole('table')).not.toBeInTheDocument();
  });
});
