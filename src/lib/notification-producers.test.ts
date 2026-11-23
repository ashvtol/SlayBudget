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
  it('one item per import with open possible duplicates (mirrors possible_duplicates)', async () => {
    const a = tx('2026-11-17', 'SHAKE SHACK 123', -3031);
    const b = tx('2026-11-18', 'SHAKE SHACK 123', -3631, { tagIds: [7] });
    const make = (resolution: 'kept' | null) =>
      createMemoryIpc({
        transactions: [{ ...a }, { ...b }],
        tags: [{ id: 7, name: 'Possible duplicate', color: '#ddb24a' }],
        imports: [{ id: 2, sourceId: 1, sourceName: 'Amex', fileName: 'full.csv', importedAt: '2026-11-22T10:00:00Z', importedRows: 1, skippedRows: 0, transactionIds: [b.id] }],
        duplicateFlags: [{ id: 1, txId: b.id, otherId: a.id, importId: 2, confidence: 'likely', reason: 'x', createdAt: '', resolvedAt: null, resolution }],
        settings: { 'notifications.baselined_at': '2026-11-20T00:00:00Z' },
      });
    const dupes = async (ipc: Ipc) => (await ipc.notificationsRefresh('2026-11-22', false)).filter((n) => n.kind === 'possibleDuplicates');
    const got = await dupes(make(null));
    expect(got.map((n) => [n.key, n.title, n.body])).toEqual([
      ['duplicates:2', '1 possible duplicate from full.csv', 'They look like transactions you already had, and are tagged Possible duplicate to review.'],
    ]);
    expect(got[0].target).toEqual({ kind: 'transactions', filter: 'duplicates' });
    expect(await dupes(make('kept'))).toEqual([]);
  });
});

describe('memory IPC price-change notifications', () => {
  const claude = (postedOn: string, cents: number) => tx(postedOn, 'ANTHROPIC CLAUDE', -cents);
  const setup = (last: [string, number]) => {
    const steady = [6, 7, 8, 9, 10, 11].map((m) => claude(`2026-${String(m).padStart(2, '0')}-05`, 2211));
    return createMemoryIpc({ transactions: [...steady, claude(...last)] });
  };
  const bodies = async (ipc: Ipc, today: string) => (await ipc.notificationsRefresh(today, false)).map((n) => [n.title, n.body, n.target]);

  it('asks about a possible new price, pointing at the charge', async () => {
    const ipc = setup(['2026-11-05', 2211]);
    await ipc.listRecurring(null);
    await ipc.notificationsRefresh('2026-11-20', true);
    await ipc.importCsvText(1, 'Statements/Visa/nov.csv', 'Date,Description,Amount\n2026-11-21,ANTHROPIC CLAUDE,-100.18\n', { kind: 'existing', sourceId: 1, remember: false });
    const [check] = await ipc.priceChecks();
    expect(await bodies(ipc, '2026-11-22')).toEqual([
      ['Anthropic Claude may have a new price', '$100.18 (was $22.11)', { kind: 'transaction', id: check.txId }],
    ]);
  });

  it('says when a confirmed price went down', async () => {
    const ipc = setup(['2026-11-20', 1000]);
    await ipc.notificationsRefresh('2026-11-19', true);
    await ipc.answerPriceCheck((await ipc.priceChecks())[0].id, 'new_price');
    const rid = (await ipc.listRecurring(null))[0].saved!.id;
    expect(await bodies(ipc, '2026-11-21')).toEqual([
      ['Anthropic Claude went down', 'From $22.11 to $10.00 (-55%)', { kind: 'recurring', id: rid }],
    ]);
  });
});
