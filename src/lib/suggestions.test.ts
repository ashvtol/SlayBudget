import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

function tx(id: number, over: Partial<Transaction> = {}): Transaction {
  return {
    id, profileId: 1, sourceId: 1, postedOn: '2026-01-0' + id, description: `ROW ${id}`, merchant: `row ${id}`,
    amountCents: -500, currency: 'USD', categoryId: 1, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over,
  };
}

const seed = () =>
  createMemoryIpc({
    transactions: [
      tx(1, { suggestedCategoryId: 20, suggestedReason: 'Known merchant: Starbucks' }),
      tx(2, { suggestedCategoryId: 29, transferPairId: 3 }),
      tx(3, { suggestedCategoryId: 29, transferPairId: 2, amountCents: 500 }),
      tx(4),
    ],
  });

const row = async (ipc: ReturnType<typeof seed>, id: number) => (await ipc.listTransactions({})).find((t) => t.id === id)!;

describe('suggestions', () => {
  it('counts rows with a suggestion and filters to them', async () => {
    const ipc = seed();
    expect(await ipc.suggestionCount(null)).toBe(3);
    expect((await ipc.listTransactions({ suggested: true })).map((t) => t.id).sort()).toEqual([1, 2, 3]);
  });

  it('accepting takes the category, makes it yours, and brings the other side of a transfer', async () => {
    const ipc = seed();
    expect(await ipc.acceptSuggestions([1, 2])).toBe(3);
    expect(await row(ipc, 1)).toMatchObject({ categoryId: 20, categorySource: 'user', suggestedCategoryId: null, reviewed: true });
    expect(await row(ipc, 3)).toMatchObject({ categoryId: 29, suggestedCategoryId: null });
    expect((await ipc.undoState()).undo).toBe('Accept Suggestion of 2 Transactions');
  });

  it('rejecting keeps the category as yours and unlinks a transfer', async () => {
    const ipc = seed();
    expect(await ipc.rejectSuggestions([2])).toBe(2);
    expect(await row(ipc, 2)).toMatchObject({ categoryId: 1, categorySource: 'user', suggestedCategoryId: null, transferPairId: null });
    expect(await row(ipc, 3)).toMatchObject({ suggestedCategoryId: null, transferPairId: null });
  });
});
