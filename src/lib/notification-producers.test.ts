import { describe, expect, it } from 'vitest';
import { createMemoryIpc, type Ipc } from './ipc';
import type { Category, Transaction } from './types';
import { DEFAULT_CONFIG } from './notification-config';

// Mirrors crates/core/tests/notification_producers_test.rs for the in-memory IPC (tests and the browser preview).
let id = 1;
const tx = (postedOn: string, description: string, amountCents: number, over: Partial<Transaction> = {}): Transaction => ({
  id: id++, profileId: 1, sourceId: 1, postedOn, description, merchant: description.toLowerCase().replace(/[^a-z ]/g, '').trim(),
  amountCents, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, ...over,
});
const groceries: Category = { id: 50, groupId: 1, name: 'Groceries', emoji: null, color: null, budgetCents: 45000, excluded: false, kind: 'expense', sortOrder: 0, archived: false };

async function withNetflix(cents: number[]) {
  const transactions = cents.map((c, i) => tx(`2026-${String(8 + i).padStart(2, '0')}-05`, 'NETFLIX', -c));
  if (cents.length === 4) transactions.push(tx('2026-12-07', 'TRADER JOES', -2500)); // statement data past Dec 5
  const ipc = createMemoryIpc({ transactions, categories: [groceries] });
  // The first look at recurrings saves the detected Netflix bill, as the app does on first run.
  const rid = (await ipc.listRecurring(null))[0].saved!.id;
  return { ipc, rid };
}
const titles = async (ipc: Ipc, today: string) => (await ipc.notificationsRefresh(today, false)).map((n) => n.title);

describe('memory IPC notification producers', () => {
  it('baseline first, then a bill N days before and on the due day, then missed', async () => {
    const { ipc, rid } = await withNetflix([1799, 1799, 1799, 1799]);
    expect(await ipc.notificationsRefresh('2026-11-20', true)).toEqual([]);
    expect(await titles(ipc, '2026-12-01')).toEqual([]);
    const got = await ipc.notificationsRefresh('2026-12-02', false);
    expect(got.map((n) => n.title)).toEqual(['Netflix is due in 3 days']);
    expect(got[0].target).toEqual({ kind: 'recurring', id: rid });
    expect(await titles(ipc, '2026-12-05')).toEqual(['Netflix is due today']);
    expect(await titles(ipc, '2026-12-08')).toEqual(['Netflix looks missed']);
  });

  it('large transactions follow the threshold; old ones never notify', async () => {
    const ipc = createMemoryIpc({ transactions: [tx('2026-10-01', 'APPLE STORE', -60000), tx('2026-11-19', 'APPLE STORE', -60000)] });
    await ipc.notificationsRefresh('2026-11-01', true);
    expect(await titles(ipc, '2026-11-20')).toEqual(['Large transaction']);
    const strict = createMemoryIpc({ transactions: [tx('2026-11-20', 'BEST BUY', -70000)] });
    await strict.setSetting('notifications.config', JSON.stringify({ ...DEFAULT_CONFIG, largeCents: 100000 }));
    await strict.notificationsRefresh('2026-11-01', true);
    expect(await titles(strict, '2026-11-21')).toEqual([]);
  });

  it('monthly recap on days 1 to 3, and over budget for the month', async () => {
    const ipc = createMemoryIpc({
      categories: [groceries],
      transactions: [tx('2026-10-12', 'WHOLE FOODS', -31260, { categoryId: 50 }), tx('2026-11-20', 'WHOLE FOODS', -48241, { categoryId: 50 })],
    });
    await ipc.notificationsRefresh('2026-10-31', true);
    const recap = await ipc.notificationsRefresh('2026-11-02', false);
    expect(recap.find((n) => n.kind === 'monthlyRecap')).toMatchObject({
      title: 'Your October recap',
      body: 'Spent $312.60 of $450.00 budgeted ($137.40 under). Top category: Groceries.',
      target: { kind: 'category', id: null, month: '2026-10' },
    });
    const over = (await ipc.notificationsRefresh('2026-11-21', false)).filter((n) => n.kind === 'overBudget');
    expect(over.map((n) => [n.title, n.body])).toEqual([['Groceries is over budget', '$482.41 of $450.00 spent in November']]);
  });

  it('varying bills are not price increases, and exactly at budget is not over', async () => {
    const { ipc } = await withNetflix([1799, 1650, 1720, 1999]);
    await ipc.notificationsRefresh('2026-10-20', true);
    expect((await ipc.notificationsRefresh('2026-11-08', false)).filter((n) => n.kind === 'priceUp')).toEqual([]);
    const atBudget = createMemoryIpc({ categories: [groceries], transactions: [tx('2026-11-25', 'WHOLE FOODS', -45000, { categoryId: 50 })] });
    await atBudget.notificationsRefresh('2026-11-01', true);
    expect((await atBudget.notificationsRefresh('2026-11-26', false)).filter((n) => n.key.startsWith('over:'))).toEqual([]);
  });

  it('a bill not seen for over a month is stale, not missed', async () => {
    const { ipc } = await withNetflix([1799, 1799, 1799, 1799]);
    await ipc.notificationsRefresh('2026-11-20', true);
    expect((await ipc.notificationsRefresh('2027-02-11', false)).filter((n) => n.kind === 'billMissed')).toEqual([]);
  });
});
