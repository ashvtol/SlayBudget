import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc, ipc, type Ipc } from '@/lib/ipc';
import type { Category, Transaction } from '@/lib/types';
import { RecategorizeOffer } from './recategorize-offer';

afterEach(() => cleanup());

const cat = (id: number, name: string): Category => ({
  id, groupId: id, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const categories = [cat(1, 'Other'), cat(2, 'Tolls'), cat(3, 'Parking')];
const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));

function tx(id: number, postedOn: string, description: string, merchant: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id, profileId: 1, sourceId: 1, postedOn, description, merchant, amountCents: -425, currency: 'USD',
    categoryId: 1, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over,
  };
}

let memory: Ipc;
function setup(transactions: Transaction[], props: Partial<Parameters<typeof RecategorizeOffer>[0]> = {}) {
  memory = createMemoryIpc({
    groups: categories.map((c) => ({ id: c.id, name: c.name, emoji: null, color: '#888888', sortOrder: c.id })),
    categories,
    transactions,
  });
  setIpc(memory);
  const onDone = vi.fn();
  render(
    <RecategorizeOffer
      merchant="wsdot goodtogo"
      sampleDescription="WSDOT GOODTOGO 1"
      categoryId={2}
      categoriesById={categoriesById}
      onDone={onDone}
      {...props}
    />,
  );
  return onDone;
}

const ready = () => screen.findByRole('region', { name: /Apply .Tolls. to other transactions/ });
const panel = () => screen.getByRole('region', { name: /Apply .Tolls. to other transactions/ });
const rows = () => within(panel()).getAllByRole('checkbox', { name: /^Include / });

const wsdot = [
  tx(1, '2026-05-01', 'WSDOT GOODTOGO 1111', 'wsdot goodtogo'),
  tx(2, '2026-05-09', 'WSDOT GOODTOGO 2222', 'wsdot goodtogo'),
  tx(3, '2026-05-03', 'WSDOT-GOODTOGO 88', 'wsdot goodtogo', { categoryId: 3 }),
  tx(4, '2026-05-04', 'SAFEWAY', 'safeway'),
];

describe('RecategorizeOffer', () => {
  it('offers all named with count and lists matches', async () => {
    setup(wsdot);
    await ready();
    expect(await within(panel()).findByRole('radio', { name: /All named .Good To Go./ })).toBeChecked();
    expect(within(panel()).getByRole('radio', { name: /All named/ }).closest('label')).toHaveTextContent('3');
    expect(rows()).toHaveLength(3);
    expect(rows().every((r) => (r as HTMLInputElement).checked)).toBe(true);
    expect(within(panel()).getByText('Parking')).toBeInTheDocument();
    expect(within(panel()).getByRole('button', { name: 'Apply to 3' })).toBeEnabled();
  });

  it('similar rows start unticked and locked rows are disabled', async () => {
    const preview = vi.fn().mockResolvedValue([
      { transaction: wsdot[0], similar: false, locked: false },
      { transaction: { ...wsdot[1], merchant: 'wsdot goodtogoo' }, similar: true, locked: false },
      { transaction: { ...wsdot[2], categoryLocked: true }, similar: false, locked: true },
    ]);
    setup(wsdot);
    memory.previewRecategorize = preview;
    cleanup();
    render(<RecategorizeOffer merchant="wsdot goodtogo" sampleDescription="WSDOT GOODTOGO 1" categoryId={2} categoriesById={categoriesById} onDone={() => {}} />);
    await ready();
    await within(panel()).findByRole('radio', { name: /All named/ });
    await waitFor(() => expect(rows()).toHaveLength(3));
    const [exact, similar, locked] = rows() as HTMLInputElement[];
    expect(exact.checked).toBe(true);
    expect(similar.checked).toBe(false);
    expect(within(panel()).getByText('similar')).toBeInTheDocument();
    expect(locked.checked).toBe(false);
    expect(locked).toBeDisabled();
    expect(within(panel()).getByRole('button', { name: 'Apply to 1' })).toBeEnabled();
  });

  it('contains updates matches as you type and needs 3 characters', async () => {
    const user = userEvent.setup();
    setup([...wsdot, tx(5, '2026-05-05', 'PAY WSDOT*GOODTOGO#9', 'pay wsdot')]);
    await ready();
    await within(panel()).findByRole('radio', { name: /All named/ });
    await user.click(within(panel()).getByRole('radio', { name: /Names containing/ }));
    const field = within(panel()).getByRole('textbox', { name: 'Name contains' });
    expect(field).toHaveValue('wsdot goodtogo');
    await waitFor(() => expect(rows()).toHaveLength(4));
    await user.clear(field);
    await user.type(field, 'ws');
    await waitFor(() => expect(within(panel()).queryAllByRole('checkbox', { name: /^Include / })).toHaveLength(0));
    expect(within(panel()).getByRole('button', { name: 'Apply to 0' })).toBeDisabled();
  });

  it('apply moves ticked rows and saves a merchant rule', async () => {
    const user = userEvent.setup();
    const onDone = setup(wsdot);
    await ready();
    await within(panel()).findByRole('radio', { name: /All named/ });
    // Newest first: 2 (May 9), 3 (May 3, Parking), 1 (May 1). Leave out the Parking one.
    await user.click(rows()[1]);
    const saveRule = vi.spyOn(memory, 'saveRule');
    await user.click(within(panel()).getByRole('button', { name: 'Apply to 2' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(2));
    expect(saveRule).toHaveBeenCalledWith({ kind: 'merchant', pattern: 'wsdot goodtogo', categoryId: 2 });
    const all = await ipc().listTransactions({});
    expect(all.filter((t) => t.categoryId === 2).map((t) => t.id).sort()).toEqual([1, 2]);
    expect(all.find((t) => t.id === 3)?.categoryId).toBe(3);
  });

  it('turning off future filing saves no rule', async () => {
    const user = userEvent.setup();
    const onDone = setup(wsdot);
    await ready();
    await within(panel()).findByRole('radio', { name: /All named/ });
    await user.click(within(panel()).getByRole('switch', { name: 'Also file future transactions this way' }));
    const saveRule = vi.spyOn(memory, 'saveRule');
    await user.click(within(panel()).getByRole('button', { name: 'Apply to 3' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(3));
    expect(saveRule).not.toHaveBeenCalled();
  });

  it('payment platforms only say one at a time', async () => {
    const user = userEvent.setup();
    const onDone = setup([tx(1, '2026-05-01', 'VENMO PAYMENT 1234567', 'venmo 1234567')], { merchant: 'venmo 1234567', sampleDescription: 'VENMO PAYMENT 1234567' });
    await ready();
    expect(await within(panel()).findByText('Venmo payments are categorized one at a time.')).toBeInTheDocument();
    expect(within(panel()).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole('button', { name: 'OK' }));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it('closes itself when nothing else matches', async () => {
    const onDone = setup([tx(4, '2026-05-04', 'SAFEWAY', 'safeway', { categoryId: 2 })], { merchant: 'safeway', sampleDescription: 'SAFEWAY' });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it('not now closes without changes', async () => {
    const user = userEvent.setup();
    const onDone = setup(wsdot);
    await ready();
    await within(panel()).findByRole('radio', { name: /All named/ });
    await user.click(within(panel()).getByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalledWith(null);
    expect((await ipc().listTransactions({})).filter((t) => t.categoryId === 2)).toHaveLength(0);
  });

  it('rows you categorized yourself start unticked', async () => {
    setup([...wsdot.slice(0, 2), tx(5, '2026-05-10', 'WSDOT GOODTOGO 5555', 'wsdot goodtogo', { categorySource: 'user', categoryId: 3 })]);
    await ready();
    const yours = within(panel()).getByRole('checkbox', { name: /WSDOT GOODTOGO 5555/ });
    expect(yours).not.toBeChecked();
    expect(within(panel()).getByRole('button', { name: /Apply to 2/ })).toBeInTheDocument();
  });

  it('shows a row’s statement details from its ⓘ', async () => {
    const user = userEvent.setup();
    setup(wsdot);
    await ready();
    const info = within(panel()).getByRole('button', { name: 'Statement details for WSDOT GOODTOGO 2222 on 2026-05-09' });
    expect(info).toHaveAttribute('aria-expanded', 'false');
    await user.click(info);
    const box = within(panel()).getByRole('group', { name: 'Statement for WSDOT GOODTOGO 2222' });
    expect(box).toHaveTextContent('Appears on statement as');
    await user.click(info);
    expect(within(panel()).queryByRole('group', { name: 'Statement for WSDOT GOODTOGO 2222' })).not.toBeInTheDocument();
    // The box closes from its own × too.
    await user.click(info);
    const again = within(panel()).getByRole('group', { name: 'Statement for WSDOT GOODTOGO 2222' });
    await user.click(within(again).getByRole('button', { name: 'Close statement details' }));
    expect(within(panel()).queryByRole('group', { name: 'Statement for WSDOT GOODTOGO 2222' })).not.toBeInTheDocument();
    expect(info).toHaveAttribute('aria-expanded', 'false');
  });
});
