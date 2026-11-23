import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

// Mirrors crates/core/tests/price_changes_test.rs and the command labels in src-tauri/src/commands.rs.
let nextId = 1;
const charge = (postedOn: string, cents: number): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'ANTHROPIC* CLAUDE SUSAN FRANCISCO CA', merchant: 'anthropic claude',
  amountCents: -cents, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
/** Claude at $22.11 on the 5th, June to November (saved as a bill from history), then the upgrade. */
const setup = (...extra: [string, number][]) => {
  nextId = 1;
  const steady = [6, 7, 8, 9, 10, 11].map((m) => charge(`2026-${String(m).padStart(2, '0')}-05`, 2211));
  const more = extra.map(([d, c]) => charge(d, c));
  return { ipc: createMemoryIpc({ transactions: [...steady, ...more] }), ids: more.map((t) => t.id) };
};

describe('memory IPC price changes', () => {
  it('asks once about a charge outside the bill range, up or down, and marks it to review', async () => {
    const { ipc, ids } = setup(['2026-11-21', 10018]);
    const [bill] = await ipc.listRecurring(null);
    const checks = await ipc.priceChecks();
    expect(checks.map((c) => [c.txId, c.recurringId, c.oldCents, c.newCents, c.direction, c.answered])).toEqual([
      [ids[0], bill.saved!.id, 2211, 10018, 'up', false],
    ]);
    expect((await ipc.priceCheckFor(ids[0]))?.id).toBe(checks[0].id);
    expect((await ipc.listTransactions({})).find((t) => t.id === ids[0])?.reviewed).toBe(false);
    expect(await ipc.priceChecks()).toHaveLength(1);
    const down = setup(['2026-12-05', 500]);
    expect((await down.ipc.priceChecks()).map((c) => c.direction)).toEqual(['down']);
  });

  it('yes, new price: the charge joins the bill, the range and day move, and the history and highlight show it', async () => {
    const { ipc, ids } = setup(['2026-11-21', 10018]);
    const [check] = await ipc.priceChecks();
    expect(await ipc.answerPriceCheck(check.id, 'new_price')).toBeNull();
    expect(await ipc.undoState()).toEqual({ undo: 'New Price', redo: null });
    const [bill] = await ipc.listRecurring(null);
    expect([bill.saved!.minCents, bill.saved!.maxCents, bill.saved!.dayOfMonth, bill.typicalAmountCents, bill.occurrences]).toEqual([6518, 13518, 21, 10018, 7]);
    expect((await ipc.listTransactions({})).find((t) => t.id === ids[0])?.recurringId).toBe(bill.saved!.id);
    const change = { changedOn: '2026-11-21', fromCents: 2211, toCents: 10018 };
    expect(await ipc.priceHistory(bill.saved!.id)).toEqual([change]);
    expect(await ipc.latestPriceChanges()).toEqual([{ recurringId: bill.saved!.id, ...change }]);
    expect(await ipc.priceChecks()).toEqual([]);
    await expect(ipc.answerPriceCheck(check.id, 'one_off')).rejects.toThrow();
    await ipc.undo();
    expect(await ipc.priceChecks()).toHaveLength(1);
    expect(await ipc.priceHistory(bill.saved!.id)).toEqual([]);
  });

  it('a one-off changes nothing and is not asked again; separate gives a draft for its own bill', async () => {
    const one = setup(['2026-11-21', 10018]);
    await one.ipc.answerPriceCheck((await one.ipc.priceChecks())[0].id, 'one_off');
    expect(await one.ipc.priceChecks()).toEqual([]);
    expect((await one.ipc.listRecurring(null))[0].saved!.maxCents).toBe(2981);
    const sep = setup(['2026-11-21', 10018]);
    const draft = await sep.ipc.answerPriceCheck((await sep.ipc.priceChecks())[0].id, 'separate');
    expect(draft).toMatchObject({ pattern: 'anthropic claude', dayOfMonth: 21 });
    expect(draft!.minCents <= 10018 && draft!.maxCents >= 10018).toBe(true);
    expect(await sep.ipc.undoState()).toEqual({ undo: 'Separate Subscription', redo: null });
  });

  it('suggests merging look-alike bills; merge keeps the older one with every charge and the newest price', async () => {
    const { ipc, ids } = setup(['2026-11-21', 10018]);
    const [first] = await ipc.listRecurring(null);
    const second = await ipc.createRecurring({
      name: 'Anthropic Claude', categoryId: null, matchKind: 'contains', pattern: 'anthropic claude',
      minCents: 2000, maxCents: 12022, frequency: 'monthly', dayOfMonth: null,
    });
    const a = first.saved!.id;
    expect(await ipc.lookAlikeRecurrings()).toEqual([[a, second]]);
    expect(await ipc.mergeRecurrings(second, a)).toBe(a);
    expect(await ipc.undoState()).toEqual({ undo: 'Merge Recurrings', redo: null });
    const bills = await ipc.listRecurring(null);
    expect(bills.map((b) => [b.saved!.id, b.saved!.matchKind, b.saved!.minCents, b.saved!.maxCents, b.saved!.dayOfMonth, b.occurrences])).toEqual([
      [a, 'merchant', 2000, 12022, null, 7],
    ]);
    expect((await ipc.listTransactions({})).find((t) => t.id === ids[0])?.recurringId).toBe(a);
    expect(await ipc.priceHistory(a)).toEqual([{ changedOn: '2026-11-21', fromCents: 2211, toCents: 10018 }]);
    await ipc.undo();
    expect((await ipc.listRecurring(null)).length).toBe(2);
    await ipc.keepRecurringsApart(a, second);
    expect(await ipc.undoState()).toEqual({ undo: 'Not the Same Subscription', redo: null });
    expect(await ipc.lookAlikeRecurrings()).toEqual([]);
  });
});
