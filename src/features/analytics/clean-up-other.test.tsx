import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc, ipc } from '@/lib/ipc';
import type { Category, Transaction } from '@/lib/types';
import { CleanUpOther } from './clean-up-other';
import { KeptScreen } from '@/app/shell/screen';

afterEach(() => cleanup());

const cat = (id: number, name: string): Category => ({
  id, groupId: id, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const categories = [{ ...cat(1, 'Other'), isOther: true }, cat(2, 'Tolls'), cat(3, 'Insurance')];
const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));

let nextId = 1;
const tx = (description: string, merchant: string, amountCents: number, categoryId: number | null = 1): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn: '2026-05-01', description, merchant, amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: false, notes: null, refundOf: null,
});

function setup() {
  nextId = 1;
  setIpc(
    createMemoryIpc({
      groups: categories.map((c) => ({ id: c.id, name: c.name, emoji: null, color: '#888888', sortOrder: c.id })),
      categories,
      transactions: [
        tx('WSDOT GOODTOGO 1', 'wsdot goodtogo', -425),
        tx('WSDOT GOODTOGO 2', 'wsdot goodtogo', -500, null),
        tx('GEICO AUTO', 'geico auto', -12000),
        tx('VENMO PAYMENT 1234567', 'venmo 1234567', -100),
        tx('VENMO PAYMENT 7654321', 'venmo 7654321', -200),
        tx('SAFEWAY', 'safeway', -900, 2),
        tx('GEICO AUTO 2', 'geico auto', -5000, 3),
      ],
    }),
  );
  const onChanged = vi.fn();
  const onReviewEach = vi.fn();
  render(<CleanUpOther categories={categories} categoriesById={categoriesById} onChanged={onChanged} onReviewEach={onReviewEach} />);
  return { onChanged, onReviewEach };
}

const list = () => screen.getByRole('region', { name: 'Clean up Other' });

describe('CleanUpOther', () => {
  it('lists Other groups largest first with count left', async () => {
    setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    const rows = within(list()).getAllByRole('row');
    expect(rows[0]).toHaveTextContent('Good To Go');
    expect(rows[0]).toHaveTextContent('2');
    expect(rows[0]).toHaveTextContent('$9.25');
    expect(rows).toHaveLength(3);
  });

  it('choosing a category opens the offer for that merchant and refreshes after apply', async () => {
    const user = userEvent.setup();
    const { onChanged } = setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    await user.click(within(list()).getByRole('button', { name: 'Category for Good To Go' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'tol{Enter}');
    const offer = await screen.findByRole('region', { name: /Apply .Tolls. to other transactions/ });
    await user.click(within(offer).getByRole('button', { name: 'Apply to 2' }));
    await waitFor(() => expect(list()).toHaveTextContent('3 left in Other'));
    expect(onChanged).toHaveBeenCalled();
    expect((await ipc().listTransactions({})).filter((t) => t.categoryId === 2)).toHaveLength(3);
  });

  it('only offers rows still in Other', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    await user.click(within(list()).getByRole('button', { name: /Category for geico/i }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'tol{Enter}');
    const offer = await screen.findByRole('region', { name: /Apply .Tolls. to other transactions/ });
    expect(within(offer).getByRole('button', { name: 'Apply to 1' })).toBeEnabled();
    expect(within(offer).queryByText('GEICO AUTO 2')).not.toBeInTheDocument();
  });

  it('"Just this one" moves the row in Other (nothing else), and counts only rows in Other', async () => {
    const user = userEvent.setup();
    const { onChanged } = setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    await user.click(within(list()).getByRole('button', { name: /Category for geico/i }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'tol{Enter}');
    const offer = await screen.findByRole('region', { name: /Apply .Tolls. to other transactions/ });
    // GEICO AUTO 2 is in Insurance already, so only one is in Other.
    expect(within(offer).getByText(/All named/).closest('label')).toHaveTextContent(/1$/);
    const saveRule = vi.spyOn(ipc(), 'saveRule');
    await user.click(within(offer).getByRole('radio', { name: 'Just this one' }));
    await user.click(within(offer).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(list()).toHaveTextContent('4 left in Other'));
    expect(onChanged).toHaveBeenCalled();
    const all = await ipc().listTransactions({});
    expect(all.find((t) => t.description === 'GEICO AUTO')?.categoryId).toBe(2);
    expect(all.find((t) => t.description === 'GEICO AUTO 2')?.categoryId).toBe(3);
    expect(saveRule).not.toHaveBeenCalled();
  });

  it('opens the offer right under the row it is for', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    const geico = within(list()).getAllByRole('row').find((r) => r.textContent?.includes('GEICO'))!;
    await user.click(within(geico).getByRole('button', { name: /Category for geico/i }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'tol{Enter}');
    const offer = await screen.findByRole('region', { name: /Apply .Tolls. to other transactions/ });
    expect(geico.nextElementSibling).toContainElement(offer);
  });

  it('leaves out transactions marked as transfers (they need no category)', async () => {
    const t = { ...tx('CAPITAL ONE TRANSFER RT09', 'capital one transfer', 15000, null), txType: 'transfer' as const };
    setIpc(createMemoryIpc({ groups: categories.map((c) => ({ id: c.id, name: c.name, emoji: null, color: '#888888', sortOrder: c.id })), categories, transactions: [t] }));
    render(<CleanUpOther categories={categories} categoriesById={categoriesById} onChanged={() => {}} onReviewEach={() => {}} />);
    await waitFor(() => expect(list()).toHaveTextContent('0 left in Other'));
    expect(list()).not.toHaveTextContent('Capital');
  });

  it('platform groups link to transactions', async () => {
    const user = userEvent.setup();
    const { onReviewEach } = setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    expect(within(list()).queryByRole('combobox', { name: /Venmo/ })).not.toBeInTheDocument();
    const venmo = within(list()).getAllByRole('row').find((r) => r.textContent?.includes('Venmo'))!;
    expect(venmo).toHaveTextContent('2');
    await user.click(within(venmo).getByRole('button', { name: 'Review each' }));
    expect(onReviewEach).toHaveBeenCalledWith('venmo');
  });
});

describe('CleanUpOther bank categories', () => {
  it("shows the bank's category and offers its match in one click (through the usual move offer)", async () => {
    const user = userEvent.setup();
    setup();
    const real = ipc();
    const groups = await real.otherGroups();
    real.otherGroups = async () =>
      groups.map((g) => (g.merchant === 'geico auto' ? { ...g, bankCategory: 'Business Services-Insurance Services', suggestedCategoryId: 3 } : g));
    cleanup();
    render(<CleanUpOther categories={categories} categoriesById={categoriesById} onChanged={() => {}} onReviewEach={() => {}} />);
    await waitFor(() => expect(within(list()).getAllByRole('row').some((r) => r.textContent?.includes('GEICO'))).toBe(true));
    const row = within(list()).getAllByRole('row').find((r) => r.textContent?.includes('GEICO'))!;
    expect(row).toHaveTextContent('Bank: Insurance Services');
    // The suggestion sits with the name, so the name keeps its room next to the category picker.
    expect(within(row).getAllByRole('cell')[0]).toContainElement(within(row).getByRole('button', { name: 'Use Insurance' }));
    await user.click(within(row).getByRole('button', { name: 'Use Insurance' }));
    // The usual offer to move this name's transactions opens, preset to Insurance.
    expect(await screen.findByRole('region', { name: /Apply .Insurance. to other transactions/ })).toBeInTheDocument();
    const goodToGo = within(list()).getAllByRole('row').find((r) => r.textContent?.includes('Good To Go'))!;
    expect(within(goodToGo).queryByRole('button', { name: /^Use / })).not.toBeInTheDocument();
  });

  it('shows what is left when you come back to it, after fixing rows elsewhere', async () => {
    setup();
    cleanup();
    const props = { categories, categoriesById, onChanged: vi.fn(), onReviewEach: vi.fn() };
    const { rerender } = render(
      <KeptScreen id="categories" active>
        <CleanUpOther {...props} />
      </KeptScreen>,
    );
    await waitFor(() => expect(list()).toHaveTextContent('Venmo'));
    rerender(
      <KeptScreen id="categories" active={false}>
        <CleanUpOther {...props} />
      </KeptScreen>,
    );
    // Fixed on the Transactions screen while this one was hidden.
    await ipc().setTransactionCategory(4, 2);
    await ipc().setTransactionCategory(5, 2);
    rerender(
      <KeptScreen id="categories" active>
        <CleanUpOther {...props} />
      </KeptScreen>,
    );
    await waitFor(() => expect(list()).not.toHaveTextContent('Venmo'));
    expect(list()).toHaveTextContent('3 left in Other');
  });

  it('shows the statement details of a group from the ⓘ beside its name', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(list()).toHaveTextContent('5 left in Other'));
    expect(within(list()).queryByRole('button', { name: /Statement details for Venmo/ })).not.toBeInTheDocument();
    const info = within(list()).getByRole('button', { name: 'Statement details for Good To Go' });
    await user.click(info);
    expect(await within(list()).findByRole('group', { name: 'Statement for WSDOT GOODTOGO 1' })).toHaveTextContent('Appears on statement as');
    expect(within(list()).getByRole('group', { name: 'Statement for WSDOT GOODTOGO 2' })).toBeInTheDocument();
    await user.click(info);
    expect(within(list()).queryByRole('group', { name: 'Statement for WSDOT GOODTOGO 1' })).not.toBeInTheDocument();
    // One × at the top of the group's details closes them all.
    await user.click(info);
    await within(list()).findByRole('group', { name: 'Statement for WSDOT GOODTOGO 1' });
    const closes = within(list()).getAllByRole('button', { name: 'Close statement details' });
    expect(closes).toHaveLength(1);
    await user.click(closes[0]);
    expect(within(list()).queryByRole('group', { name: /Statement for WSDOT/ })).not.toBeInTheDocument();
  });
});
