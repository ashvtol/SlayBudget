import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Transaction } from '@/lib/types';
import { RecentImports } from './recent-imports';

afterEach(() => cleanup());
const tx = (id: number, description: string): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn: '2026-11-20', description, merchant: description.toLowerCase(), amountCents: -1000, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});

describe('RecentImports', () => {
  it('lists imports and undoes one after a confirm with the count', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({
      transactions: [tx(1, 'COFFEE'), tx(2, 'SHELL'), tx(3, 'GAS')],
      imports: [
        { id: 1, sourceId: 1, sourceName: 'Amex', fileName: 'nov-1.csv', importedAt: '2026-11-18T10:00:00Z', importedRows: 1, skippedRows: 0, transactionIds: [1] },
        { id: 2, sourceId: 1, sourceName: 'Amex', fileName: 'nov-all.csv', importedAt: '2026-11-22T10:00:00Z', importedRows: 2, skippedRows: 1, transactionIds: [2, 3] },
      ],
    }));
    render(<RecentImports />);
    const section = await screen.findByRole('region', { name: 'Recent imports' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('nov-all.csv');
    expect(rows[0]).toHaveTextContent('Amex');
    expect(rows[0]).toHaveTextContent('2 added');
    await user.click(within(rows[0]).getByRole('button', { name: 'Undo import nov-all.csv' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Undo "nov-all.csv"?' });
    expect(dialog).toHaveTextContent('Removes the 2 transactions it added');
    await user.click(within(dialog).getByRole('button', { name: 'Undo import' }));
    await waitFor(() => expect(within(section).getAllByRole('listitem')).toHaveLength(1));
    expect((await ipc().listTransactions({})).map((t) => t.id)).toEqual([1]);
  });

  it('says so when there are no imports yet', async () => {
    setIpc(createMemoryIpc());
    render(<RecentImports />);
    expect(await screen.findByText('Nothing imported yet.')).toBeInTheDocument();
  });
});
