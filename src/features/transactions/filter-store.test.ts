import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Transaction } from '@/lib/types';
import { useTransactionsStore } from './transactions-store';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'amountCents'>): Transaction {
  return { profileId: 1, sourceId: 1, description: `T${over.id}`, merchant: `t${over.id}`, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over };
}

const seed = {
  transactions: [
    tx({ id: 1, postedOn: '2026-11-14', amountCents: -6418, categoryId: 10, reviewed: true }),
    tx({ id: 2, postedOn: '2026-11-10', amountCents: -4800, categoryId: 20, sourceId: 2 }),
    tx({ id: 3, postedOn: '2026-10-05', amountCents: -1799 }),
  ],
};

function reset() {
  useTransactionsStore.setState({ transactions: [], filter: {}, sort: 'newest', cursor: 0 });
}

describe('filter and sort', () => {
  beforeEach(() => {
    setIpc(createMemoryIpc(seed));
    reset();
  });

  it('applies and merges filters, reloading', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().applyFilter({ reviewed: false });
    expect(s().transactions.map((t) => t.id)).toEqual([2, 3]);
    await s().applyFilter({ categoryIds: [20] });
    expect(s().filter.reviewed).toBe(false);
    expect(s().transactions.map((t) => t.id)).toEqual([2]);
  });

  it('clears individual filter keys', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().applyFilter({ reviewed: false, categoryIds: [20] });
    await s().clearFilter(['categoryIds']);
    expect(s().filter.categoryIds).toBeUndefined();
    expect(s().transactions.map((t) => t.id)).toEqual([2, 3]);
  });

  it('reverses order when sorted oldest, and cursor follows the ordered list', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    expect(s().orderedTransactions().map((t) => t.id)).toEqual([1, 2, 3]);
    expect(s().cursorId()).toBe(1);
    s().setSort('oldest');
    expect(s().orderedTransactions().map((t) => t.id)).toEqual([3, 2, 1]);
    expect(s().cursorId()).toBe(3);
  });

  it('sorts by size of amount, largest or smallest first, money in or out alike', async () => {
    setIpc(createMemoryIpc({ transactions: [...seed.transactions, tx({ id: 4, postedOn: '2026-11-01', amountCents: 5000 })] }));
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    s().setSort('amountDesc');
    expect(s().orderedTransactions().map((t) => t.id)).toEqual([1, 4, 2, 3]);
    expect(s().cursorId()).toBe(1);
    s().setSort('amountAsc');
    expect(s().orderedTransactions().map((t) => t.id)).toEqual([3, 2, 4, 1]);
  });
});
