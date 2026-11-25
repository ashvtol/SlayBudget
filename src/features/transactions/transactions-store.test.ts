import { vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Transaction } from '@/lib/types';
import { useTransactionsStore } from './transactions-store';
import { useTagsStore } from '@/lib/stores/tags-store';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'description' | 'amountCents'>): Transaction {
  return { profileId: 1, sourceId: 1, merchant: over.description.toLowerCase(), currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over };
}

const seed = {
  transactions: [
    tx({ id: 1, postedOn: '2026-11-14', description: 'WHOLE FOODS', amountCents: -6418, categoryId: 10 }),
    tx({ id: 2, postedOn: '2026-11-10', description: 'SHELL OIL', amountCents: -4800, categoryId: 20 }),
    tx({ id: 3, postedOn: '2026-10-05', description: 'NETFLIX', amountCents: -1799 }),
  ],
};

function reset() {
  useTransactionsStore.setState({ transactions: [], categoriesById: {}, selected: new Set(), cursor: 0, loading: false });
}

describe('transactions store', () => {
  beforeEach(() => {
    setIpc(createMemoryIpc(seed));
    reset();
  });

  it('loads transactions and a category lookup', async () => {
    await useTransactionsStore.getState().load(null);
    const s = useTransactionsStore.getState();
    expect(s.transactions.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(s.categoriesById[10].name).toBe('Groceries');
  });

  it('gives categories without a color their group color, for pills', async () => {
    await useTransactionsStore.getState().load(null);
    expect(useTransactionsStore.getState().categoriesById[10].color).toBe('#ff9500');
  });

  it('toggles reviewed for several rows', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().toggleReviewed([1, 2]);
    expect(s().transactions.find((t) => t.id === 1)!.reviewed).toBe(true);
    expect(s().transactions.filter((t) => t.reviewed).length).toBe(2);
  });

  it('sets a category and marks the row reviewed', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().setCategory(3, 10);
    const t3 = s().transactions.find((t) => t.id === 3)!;
    expect(t3.categoryId).toBe(10);
    expect(t3.reviewed).toBe(true);
  });

  it('setCategory moves the merchant’s other rows and leaves a note with Undo and Only this one', async () => {
    setIpc(
      createMemoryIpc({
        transactions: [
          tx({ id: 1, postedOn: '2026-11-14', description: 'WHOLE FOODS', amountCents: -6418, categoryId: 10 }),
          tx({ id: 2, postedOn: '2026-11-10', description: 'WHOLE FOODS', amountCents: -4800, categoryId: 10 }),
          tx({ id: 3, postedOn: '2026-10-05', description: 'NETFLIX', amountCents: -1799 }),
        ],
      }),
    );
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().setCategory(1, 20);
    expect(s().byId(2)?.categoryId).toBe(20);
    const name = s().categoriesById[20]?.name;
    expect(s().moveNote).toMatchObject({ transactionId: 1, categoryId: 20, text: `Moved 1 other Whole Foods transaction to ${name}` });

    await s().onlyThisOne();
    expect(s().moveNote).toBeNull();
    expect(s().byId(1)?.categoryId).toBe(20);
    expect(s().byId(2)?.categoryId).toBe(10);

    await s().setCategory(1, 30);
    await s().undoMove();
    expect(s().moveNote).toBeNull();
    expect(s().byId(1)?.categoryId).toBe(20);
    expect(s().byId(2)?.categoryId).toBe(10);
  });

  it('a note left from before another change does nothing, and goes away', async () => {
    setIpc(
      createMemoryIpc({
        transactions: [
          tx({ id: 1, postedOn: '2026-11-14', description: 'WHOLE FOODS', amountCents: -6418, categoryId: 10 }),
          tx({ id: 2, postedOn: '2026-11-10', description: 'WHOLE FOODS', amountCents: -4800, categoryId: 10 }),
          tx({ id: 3, postedOn: '2026-10-05', description: 'NETFLIX', amountCents: -1799 }),
        ],
      }),
    );
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().setCategory(1, 20);
    await s().setNotes(3, 'later');
    await s().onlyThisOne();
    expect(s().moveNote).toBeNull();
    expect(s().byId(2)?.categoryId).toBe(20);
    expect(s().byId(3)?.notes).toBe('later');
    await s().setCategory(2, 10);
    await s().setNotes(3, 'again');
    await s().undoMove();
    expect(s().byId(3)?.notes).toBe('again');
  });

  it('a change that moves nothing leaves no note', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    await s().setCategory(3, 10);
    expect(s().byId(3)?.categoryId).toBe(10);
    expect(s().moveNote).toBeNull();
  });

  it('toggles filters from the latest filter, even before loads finish', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null, { categoryIds: [10, 20] });
    const a = s().toggleFilter({ kind: 'category', value: 10 });
    const b = s().toggleFilter({ kind: 'category', value: 20 });
    expect(s().filter.categoryIds ?? []).toEqual([]);
    await Promise.all([a, b]);
    expect(s().filter.categoryIds ?? []).toEqual([]);
    expect(s().transactions).toHaveLength(3);
  });

  it('keeps only the newest load when loads finish out of order', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    const { ipc } = await import('@/lib/ipc');
    const real = ipc().listTransactions.bind(ipc());
    let release: () => void = () => {};
    const spy = vi
      .spyOn(ipc(), 'listTransactions')
      .mockImplementationOnce(async (f) => {
        await new Promise<void>((r) => (release = r));
        return real(f);
      })
      .mockImplementation((f) => real(f));
    const slow = s().applyFilter({ categoryIds: [10] });
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await s().applyFilter({ categoryIds: [20] });
    release();
    await slow;
    expect(s().filter.categoryIds).toEqual([20]);
    expect(s().transactions.map((t) => t.id)).toEqual([2]);
  });

  it('focusById clears month and recurring filters too', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null, { months: ['2026-10'], merchants: ['nobody'] });
    await s().focusById(1);
    expect(s().filter.months).toBeUndefined();
    expect(s().filter.merchants).toBeUndefined();
    expect(s().cursorId()).toBe(1);
  });

  it('tracks selection and cursor', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    s().toggleSelect(2);
    expect(s().selected.has(2)).toBe(true);
    s().toggleSelect(2);
    expect(s().selected.has(2)).toBe(false);
    s().setCursor(2);
    expect(s().cursorId()).toBe(3);
    s().moveCursor(-1);
    expect(s().cursorId()).toBe(2);
    s().moveCursor(-5);
    expect(s().cursor).toBe(0);
  });

  it('counts unreviewed', async () => {
    const s = () => useTransactionsStore.getState();
    await s().load(null);
    expect(s().unreviewedCount()).toBe(3);
    await s().toggleReviewed([1]);
    expect(s().unreviewedCount()).toBe(2);
  });
});

describe('transactions store tags', () => {
  beforeEach(async () => {
    setIpc(createMemoryIpc({ ...seed, tags: [{ id: 1, name: 'Work', color: '#4a8ef0' }, { id: 2, name: 'Trip', color: '#e5484d' }] }));
    reset();
    await useTransactionsStore.getState().load(null);
  });

  it('adds a tag to rows that lack it, and removes it when every row has it', async () => {
    const s = useTransactionsStore.getState();
    await s.toggleTag([1], 1);
    expect(useTransactionsStore.getState().byId(1)?.tagIds).toEqual([1]);
    await s.toggleTag([1, 2], 1); // mixed: adds to all
    expect(useTransactionsStore.getState().byId(2)?.tagIds).toEqual([1]);
    await s.toggleTag([1, 2], 1); // all have it: removes from all
    expect(useTransactionsStore.getState().byId(1)?.tagIds).toEqual([]);
    expect(useTransactionsStore.getState().byId(2)?.tagIds).toEqual([]);
  });

  it('creates a tag and puts it on the rows', async () => {
    const id = await useTransactionsStore.getState().createTag([2, 3], ' Gift ');
    expect(useTransactionsStore.getState().byId(3)?.tagIds).toEqual([id]);
    expect(useTagsStore.getState().byId[id]?.name).toBe('Gift');
    expect(useTagsStore.getState().byId[id]?.count).toBe(2);
  });

  it('drops a deleted tag from the filter on load', async () => {
    await useTransactionsStore.getState().applyFilter({ tagIds: [1, 99] });
    expect(useTransactionsStore.getState().filter.tagIds).toEqual([1]);
  });
});
