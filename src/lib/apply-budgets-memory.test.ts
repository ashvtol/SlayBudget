import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';

describe('applyBudgets (memory)', () => {
  it('sets each budget from this month on, as one undo step', async () => {
    const ipc = createMemoryIpc();
    const cats = await ipc.listCategories();
    const rest = cats.find((c) => c.name === 'Groceries')!.id;
    const shop = cats.find((c) => c.name === 'Fuel')!.id;
    const before = cats.find((c) => c.id === rest)!.budgetCents;
    await ipc.setBudget(rest, '2026-09', 70000);
    await ipc.applyBudgets('2026-11', [{ categoryId: rest, amountCents: 31500 }, { categoryId: shop, amountCents: 27500 }]);
    const after = await ipc.listCategories();
    expect(after.find((c) => c.id === rest)!.budgetCents).toBe(31500);
    expect(after.find((c) => c.id === shop)!.budgetCents).toBe(27500);
    expect((await ipc.undoState()).undo).toBe('Use Suggested Budgets');
    await ipc.undo();
    expect((await ipc.listCategories()).find((c) => c.id === rest)!.budgetCents).toBe(before);
  });
});
