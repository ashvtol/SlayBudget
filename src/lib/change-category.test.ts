import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

function tx(id: number, merchant: string, over: Partial<Transaction> = {}): Transaction {
  return {
    id, profileId: 1, sourceId: 1, postedOn: `2026-01-${String(id).padStart(2, '0')}`, description: merchant.toUpperCase(), merchant,
    amountCents: -500 - id, currency: 'USD', categoryId: 1, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over,
  };
}

const seed = () =>
  createMemoryIpc({
    transactions: [
      tx(1, 'starbucks'),
      tx(2, 'starbucks'),
      tx(3, 'starbucks', { categorySource: 'user' }),
      tx(4, 'starbucks', { categoryLocked: true }),
      tx(5, 'safeway'),
    ],
  });

const cat = async (ipc: ReturnType<typeof seed>, id: number) => (await ipc.listTransactions({})).find((t) => t.id === id)?.categoryId;

describe('changing a category', () => {
  it('moves the merchant’s other rows, not yours or locked ones, and says how many', async () => {
    const ipc = seed();
    expect(await ipc.setTransactionCategory(1, 20)).toMatchObject({ moved: 1, merchant: 'starbucks', suggested: 0 });
    expect(await cat(ipc, 2)).toBe(20);
    expect(await cat(ipc, 3)).toBe(1);
    expect(await cat(ipc, 4)).toBe(1);
    expect(await cat(ipc, 5)).toBe(1);
  });

  it('Only this one puts the others back and keeps the change, as one undo step', async () => {
    const ipc = seed();
    const { step } = await ipc.setTransactionCategory(1, 20);
    await ipc.keepOnlyThisOne(1, 20, step!);
    expect(await cat(ipc, 1)).toBe(20);
    expect(await cat(ipc, 2)).toBe(1);
    expect((await ipc.undoState()).undo).toBe('Change Category');
    await ipc.undo();
    expect(await cat(ipc, 1)).toBe(1);
    expect((await ipc.undoState()).undo).toBeNull();
  });

  it('Undo takes back the change and the moves together', async () => {
    const ipc = seed();
    await ipc.setTransactionCategory(1, 20);
    await ipc.undo();
    expect(await cat(ipc, 1)).toBe(1);
    expect(await cat(ipc, 2)).toBe(1);
  });

  it('Only this one and Undo refuse once something else changed after the category change', async () => {
    const ipc = seed();
    const { step } = await ipc.setTransactionCategory(1, 20);
    await ipc.updateTransaction(5, { notes: 'later edit' });
    await expect(ipc.keepOnlyThisOne(1, 20, step!)).rejects.toThrow();
    await expect(ipc.undoStep(step!)).rejects.toThrow();
    expect(await cat(ipc, 2)).toBe(20);
    expect((await ipc.listTransactions({})).find((t) => t.id === 5)?.notes).toBe('later edit');
    await ipc.undo();
    expect(await ipc.undoStep(step!)).toBe('Change Category');
    expect(await cat(ipc, 2)).toBe(1);
  });

  it('sets one category on several rows, makes them yours, and moves nothing else', async () => {
    const ipc = seed();
    await ipc.listTransactions({});
    expect(await ipc.setCategories([1, 5], 30)).toBe(2);
    expect(await cat(ipc, 1)).toBe(30);
    expect(await cat(ipc, 5)).toBe(30);
    expect(await cat(ipc, 2)).toBe(1);
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.categorySource).toBe('user');
    expect((await ipc.undoState()).undo).toBe('Change Category of 2 Transactions');
  });

  it('a payment app moves nothing, says so, and lists the same name to ask about', async () => {
    const ipc = createMemoryIpc({
      transactions: [tx(1, 'wise inc wise'), tx(2, 'wise inc wise', { categorySource: 'user', categoryId: 29 }), tx(3, 'wise inc wise'), tx(4, 'safeway')],
    });
    const change = await ipc.setTransactionCategory(1, 20);
    expect(change).toMatchObject({ moved: 0, platform: true });
    expect(await cat(ipc as ReturnType<typeof seed>, 3)).toBe(1);
    expect((await ipc.sameMerchant(1, 20)).map((m) => m.transaction.id).sort()).toEqual([2, 3]);
  });
});
