import { createMemoryIpc, NEW_TAG_ORDER, TAG_PALETTE } from './ipc';
import type { Transaction } from './types';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'description' | 'amountCents'>): Transaction {
  return {
    profileId: 1,
    sourceId: 1,
    merchant: over.description.toLowerCase(),
    currency: 'USD',
    categoryId: null,
    categoryLocked: false,
    reviewed: false,
    notes: null,
    refundOf: null,
    txType: over.amountCents > 0 ? 'income' : 'regular',
    ...over,
  };
}

describe('memory ipc settings and profiles', () => {
  it('stores and returns settings', async () => {
    const ipc = createMemoryIpc();
    expect(await ipc.getSetting('theme')).toBeNull();
    await ipc.setSetting('theme', 'aurora');
    expect(await ipc.getSetting('theme')).toBe('aurora');
  });

  it('lists the seeded profiles', async () => {
    const ipc = createMemoryIpc({ profiles: [{ id: 1, name: 'Me', color: '#5b8cff', sortOrder: 0 }] });
    expect(await ipc.listProfiles()).toEqual([{ id: 1, name: 'Me', color: '#5b8cff', sortOrder: 0 }]);
  });
});

describe('memory ipc transactions', () => {
  const seed = {
    transactions: [
      tx({ id: 1, postedOn: '2026-11-14', description: 'WHOLE FOODS', amountCents: -6418, categoryId: 10, reviewed: true }),
      tx({ id: 2, postedOn: '2026-11-10', description: 'SHELL OIL', amountCents: -4800, categoryId: 20 }),
      tx({ id: 3, postedOn: '2026-10-05', description: 'NETFLIX', amountCents: -1799, categoryId: 10, profileId: 2 }),
    ],
  };

  it('lists newest first and counts', async () => {
    const ipc = createMemoryIpc(seed);
    const all = await ipc.listTransactions({});
    expect(all.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(await ipc.countTransactions({})).toBe(3);
  });

  it('filters by profile, text, category and review status', async () => {
    const ipc = createMemoryIpc(seed);
    expect((await ipc.listTransactions({ profileId: 1 })).map((t) => t.id)).toEqual([1, 2]);
    expect((await ipc.listTransactions({ text: 'netflix' })).map((t) => t.id)).toEqual([3]);
    expect((await ipc.listTransactions({ categoryIds: [10] })).map((t) => t.id)).toEqual([1, 3]);
    expect((await ipc.listTransactions({ reviewed: false })).map((t) => t.id)).toEqual([2, 3]);
  });

  it('pages with limit and offset', async () => {
    const ipc = createMemoryIpc(seed);
    expect((await ipc.listTransactions({ limit: 1, offset: 1 })).map((t) => t.id)).toEqual([2]);
  });

  it('updates one and bulk-updates many', async () => {
    const ipc = createMemoryIpc(seed);
    await ipc.updateTransaction(2, { categoryId: 99, reviewed: true });
    const t2 = (await ipc.listTransactions({})).find((t) => t.id === 2)!;
    expect(t2.categoryId).toBe(99);
    expect(t2.reviewed).toBe(true);
    const n = await ipc.bulkUpdateTransactions([1, 3], { reviewed: true });
    expect(n).toBe(2);
    expect(await ipc.countTransactions({ reviewed: false })).toBe(0);
  });
});

describe('memory ipc categories', () => {
  it('lists groups and categories, creates and updates', async () => {
    const ipc = createMemoryIpc();
    const groups = await ipc.listCategoryGroups();
    expect(groups.length).toBeGreaterThan(0);
    const before = (await ipc.listCategories()).length;
    const id = await ipc.createCategory({ group: 'Pets', name: 'Vet', budgetCents: 5000 });
    expect((await ipc.listCategories()).length).toBe(before + 1);
    await ipc.updateCategory(id, { budgetCents: 9000, excluded: true });
    const cat = (await ipc.listCategories()).find((c) => c.id === id)!;
    expect(cat.budgetCents).toBe(9000);
    expect(cat.excluded).toBe(true);
  });
});

describe('memory ipc analytics skip excluded categories', () => {
  const categories = [
    { id: 10, groupId: 1, name: 'Groceries', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 0, archived: false },
    { id: 99, groupId: 1, name: 'Card Payment', emoji: null, color: null, budgetCents: null, excluded: true, kind: 'transfer' as const, sortOrder: 1, archived: false },
  ];
  const ipc = createMemoryIpc({
    categories,
    transactions: [
      tx({ id: 1, postedOn: '2026-11-03', description: 'WHOLE FOODS', amountCents: -5000, categoryId: 10 }),
      tx({ id: 2, postedOn: '2026-11-04', description: 'AMEX PAYMENT', amountCents: -185000, categoryId: 99 }),
      tx({ id: 3, postedOn: '2026-11-05', description: 'PAYROLL', amountCents: 300000 }),
    ],
  });

  it('leaves them out of monthly totals and cash flow', async () => {
    const [m] = await ipc.analyticsMonthly(null, 'month', '2026-11-21');
    expect(m.expenseCents).toBe(5000);
    const flow = await ipc.analyticsCashflow(null, 'month', '2026-11-21');
    expect(flow.current.expenseCents).toBe(5000);
  });

  it('leaves them out of category totals', async () => {
    const cats = await ipc.analyticsCategories(null, 'month', '2026-11-21');
    expect(cats.map((c) => c.categoryId)).toEqual([10]);
  });
});

describe('memory ipc listRecurring', () => {
  it('returns every detected bill, including ones whose next date has passed', async () => {
    const ipc = createMemoryIpc({
      transactions: ['2026-04-03', '2026-05-03', '2026-06-03'].map((postedOn, i) => ({ ...tx({ id: i + 1, postedOn, description: 'GEICO', amountCents: -14200 }), merchant: 'geico auto' })),
    });
    expect((await ipc.listRecurring(null)).map((r) => [r.merchant, r.nextDate])).toEqual([['geico auto', '2026-07-03']]);
    expect(await ipc.analyticsRecurring(null, '2026-11-21')).toEqual([]);
  });
});

describe('memory ipc category management', () => {
  const groups = [
    { id: 1, name: 'Food & Drink', emoji: null, color: '#ff9500', sortOrder: 0 },
    { id: 2, name: 'Other', emoji: null, color: '#8e8e93', sortOrder: 1 },
  ];
  const cats = [
    { id: 10, groupId: 1, name: 'Groceries', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 0, archived: false },
    { id: 11, groupId: 1, name: 'Coffee', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 1, archived: false },
    { id: 99, groupId: 2, name: 'Other', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 2, archived: false },
  ];
  const make = () =>
    createMemoryIpc({
      groups: groups.map((g) => ({ ...g })),
      categories: cats.map((c) => ({ ...c })),
      transactions: [
        tx({ id: 1, postedOn: '2026-06-01', description: 'BLUE BOTTLE', amountCents: -500, categoryId: 11 }),
        tx({ id: 2, postedOn: '2026-06-02', description: 'BLUE BOTTLE', amountCents: -450, categoryId: 11 }),
      ],
    });
  const groupOf = async (ipc: ReturnType<typeof make>, id: number) => {
    const c = (await ipc.listCategories()).find((x) => x.id === id)!;
    return (await ipc.listCategoryGroups()).find((g) => g.id === c.groupId)!.name;
  };

  it('refuses a duplicate name on create and rename, ignoring case and emoji', async () => {
    const ipc = make();
    await expect(ipc.createCategory({ group: 'x', name: '☕️ coffee', groupTarget: 'own' })).rejects.toThrow(/already exists/);
    await expect(ipc.updateCategory(10, { name: 'COFFEE' })).rejects.toThrow(/already exists/);
    await expect(ipc.updateCategory(10, { name: '  ' })).rejects.toThrow(/empty/);
  });

  it('deletes a category, moving its transactions to Other and reporting how many', async () => {
    const ipc = make();
    expect(await ipc.deleteCategory(11)).toEqual({ moved: 2 });
    const rows = await ipc.listTransactions({});
    expect(rows.every((t) => t.categoryId === 99)).toBe(true);
    expect((await ipc.listCategories()).map((c) => c.id)).not.toContain(11);
  });

  it('never deletes Other, even after it is renamed', async () => {
    const ipc = make();
    await ipc.updateCategory(99, { name: 'Misc' });
    await expect(ipc.deleteCategory(99)).rejects.toThrow(/can't be deleted/);
  });

  it('moves a category to an existing group, a new group, or its own', async () => {
    const ipc = make();
    await ipc.moveCategoryToGroup(11, { new: 'Drinks' });
    expect(await groupOf(ipc, 11)).toBe('Drinks');
    await ipc.moveCategoryToGroup(11, { existing: 1 });
    expect(await groupOf(ipc, 11)).toBe('Food & Drink');
    await ipc.moveCategoryToGroup(11, 'own');
    expect(await groupOf(ipc, 11)).toBe('Coffee');
  });

  it('renames and ungroups groups, leaving no empty groups', async () => {
    const ipc = make();
    await expect(ipc.renameGroup(1, 'other')).rejects.toThrow(/already exists/);
    await ipc.renameGroup(1, 'Food');
    await ipc.ungroup(1);
    const names = (await ipc.listCategoryGroups()).map((g) => g.name).sort();
    expect(names).toEqual(['Coffee', 'Groceries', 'Other']);
  });

  it('creates in a chosen group and saves color changes', async () => {
    const ipc = make();
    const id = await ipc.createCategory({ group: 'ignored', name: 'Tea', color: '#00ff00', groupTarget: { existing: 1 } });
    expect(await groupOf(ipc, id)).toBe('Food & Drink');
    await ipc.updateCategory(id, { color: '#123456' });
    expect((await ipc.listCategories()).find((c) => c.id === id)?.color).toBe('#123456');
  });
});

describe('memory ipc renaming a top-level category', () => {
  it('renames its own group with it, and refuses a name another group already has', async () => {
    const ipc = createMemoryIpc({
      groups: [{ id: 1, name: 'Trips', emoji: null, color: '#000', sortOrder: 0 }, { id: 2, name: 'Kids', emoji: null, color: '#000', sortOrder: 1 }],
      categories: [
        { id: 10, groupId: 1, name: 'Trips', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false },
        { id: 20, groupId: 2, name: 'Toys', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: 1, archived: false },
      ],
    });
    await ipc.updateCategory(10, { name: 'Vacations' });
    expect((await ipc.listCategoryGroups()).find((g) => g.id === 1)?.name).toBe('Vacations');
    await expect(ipc.updateCategory(10, { name: 'Kids' })).rejects.toThrow(/already exists/);
    expect((await ipc.listCategories()).find((c) => c.id === 10)?.name).toBe('Vacations');
  });
});

describe('memory ipc categoryUsage', () => {
  it('counts transactions and split parts in the category, as delete would move', async () => {
    const ipc = createMemoryIpc({
      transactions: [
        tx({ id: 1, postedOn: '2026-06-01', description: 'A', amountCents: -500, categoryId: 10 }),
        tx({ id: 2, postedOn: '2026-06-02', description: 'B', amountCents: -900, categoryId: 10 }),
      ],
    });
    await ipc.splitTransaction(2, [{ amountCents: -400, categoryId: 10 }, { amountCents: -500, categoryId: 10 }]);
    expect(await ipc.categoryUsage(10)).toBe(4);
  });
});

describe('memory ipc recategorizing', () => {
  const cats = [
    { id: 1, groupId: 1, name: 'Other', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 0, archived: false },
    { id: 2, groupId: 2, name: 'Tolls', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 1, archived: false },
    { id: 3, groupId: 3, name: 'Restaurants', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 2, archived: false },
  ];
  const groups = [
    { id: 1, name: 'Other', emoji: null, color: '#888888', sortOrder: 0 },
    { id: 2, name: 'Transportation', emoji: null, color: '#888888', sortOrder: 1 },
    { id: 3, name: 'Food', emoji: null, color: '#888888', sortOrder: 2 },
  ];
  const seed = () =>
    createMemoryIpc({
      groups: groups.map((g) => ({ ...g })),
      categories: cats.map((c) => ({ ...c })),
      transactions: [
        tx({ id: 1, postedOn: '2026-05-01', description: 'WSDOT-GOODTOGO 1111', merchant: 'wsdot goodtogo', amountCents: -425, categoryId: 1 }),
        tx({ id: 2, postedOn: '2026-05-09', description: 'WSDOT GOODTOGO 2222', merchant: 'wsdot goodtogo', amountCents: -500, categoryId: 1 }),
        tx({ id: 3, postedOn: '2026-05-10', description: 'WSDOT GOODTOGO 3', merchant: 'wsdot goodtogo', amountCents: -425, categoryId: 1, categoryLocked: true }),
        tx({ id: 4, postedOn: '2026-05-11', description: 'VENMO PAYMENT 1234567', merchant: 'venmo 1234567', amountCents: -100, categoryId: 1 }),
        tx({ id: 5, postedOn: '2026-05-12', description: 'DIN TAI FUNG', merchant: 'din tai', amountCents: -4000, categoryId: null }),
      ],
    });

  it('previews exact and contains matches and flags locked rows', async () => {
    const ipc = seed();
    const exact = await ipc.previewRecategorize({ kind: 'merchant', value: 'wsdot goodtogo' }, 2);
    expect(exact.map((m) => m.transaction.id)).toEqual([3, 2, 1]);
    expect(exact.find((m) => m.transaction.id === 3)?.locked).toBe(true);
    const contains = await ipc.previewRecategorize({ kind: 'contains', value: 'wsdot-goodtogo 1' }, 2);
    expect(contains.map((m) => m.transaction.id)).toEqual([1]);
    expect(await ipc.previewRecategorize({ kind: 'contains', value: 'ws' }, 2)).toEqual([]);
    expect(await ipc.previewRecategorize({ kind: 'merchant', value: 'venmo 1234567' }, 2)).toEqual([]);
    expect(await ipc.previewRecategorize({ kind: 'contains', value: 'venmo' }, 2)).toEqual([]);
  });

  it('matches merchant keys case-insensitively (sample data is capitalized)', async () => {
    const ipc = createMemoryIpc({
      categories: cats.map((c) => ({ ...c })),
      groups: groups.map((g) => ({ ...g })),
      transactions: [
        tx({ id: 1, postedOn: '2026-05-01', description: 'TARGET POS', merchant: 'Target', amountCents: -100, categoryId: 1 }),
        tx({ id: 2, postedOn: '2026-05-02', description: 'TARGET POS', merchant: 'Target', amountCents: -100, categoryId: 1 }),
      ],
    });
    expect(await ipc.previewRecategorize({ kind: 'merchant', value: 'Target' }, 2)).toHaveLength(2);
    expect((await ipc.otherGroups())[0]).toMatchObject({ merchant: 'target', count: 2 });
  });

  it('applies to unlocked rows, marks them reviewed and counts', async () => {
    const ipc = seed();
    expect(await ipc.applyRecategorize([1, 2, 3], 2)).toBe(2);
    const rows = await ipc.listTransactions({});
    expect(rows.find((t) => t.id === 1)).toMatchObject({ categoryId: 2, reviewed: true });
    expect(rows.find((t) => t.id === 3)?.categoryId).toBe(1);
  });

  it('setTransactionCategory updates and marks reviewed', async () => {
    const ipc = seed();
    await ipc.setTransactionCategory(5, 3);
    expect((await ipc.listTransactions({})).find((t) => t.id === 5)).toMatchObject({ categoryId: 3, reviewed: true });
  });

  it('saves rules, replacing the same pattern', async () => {
    const ipc = seed();
    const a = await ipc.saveRule({ kind: 'merchant', pattern: 'wsdot goodtogo', categoryId: 2 });
    const b = await ipc.saveRule({ kind: 'merchant', pattern: 'WSDOT goodtogo', categoryId: 3 });
    expect(b).not.toBe(a);
  });

  it('groups Other by merchant, largest first', async () => {
    const ipc = seed();
    const groupsOut = await ipc.otherGroups();
    expect(groupsOut[0]).toMatchObject({ merchant: 'wsdot goodtogo', count: 3, totalCents: 1350, platform: false });
    expect(groupsOut.find((g) => g.merchant.startsWith('venmo'))?.platform).toBe(true);
    expect(groupsOut.reduce((n, g) => n + g.count, 0)).toBe(5);
  });

  it('previews and imports a Financial-Tracker model', async () => {
    const ipc = seed();
    const model = JSON.stringify({ learningModel: { 'din tai': 'Restaurants', 'the knot': 'Wedding', venmo: 'Transfer' } });
    const p = await ipc.previewFtModel(model);
    expect(p).toEqual([
      { merchant: 'din tai', ftCategory: 'Restaurants', target: { kind: 'existing', value: 3 }, moves: 1 },
      { merchant: 'the knot', ftCategory: 'Wedding', target: { kind: 'new', value: 'Wedding' }, moves: 0 },
    ]);
    const r = await ipc.importFtModel(p.map(({ merchant, target }) => ({ merchant, target })));
    expect(r).toEqual({ learned: 2, moved: 1, created: 1 });
    expect((await ipc.listCategories()).some((c) => c.name === 'Wedding')).toBe(true);
    expect((await ipc.listTransactions({})).find((t) => t.id === 5)?.categoryId).toBe(3);
  });
});

describe('memory ipc month and merchant filters', () => {
  it('matches any month and any merchant, and both kinds together', async () => {
    const ipc = createMemoryIpc({
      transactions: [
        tx({ id: 1, postedOn: '2026-05-03', description: 'WSDOT 1', merchant: 'wsdot goodtogo', amountCents: -100 }),
        tx({ id: 2, postedOn: '2026-06-10', description: 'WSDOT 2', merchant: 'wsdot goodtogo', amountCents: -100 }),
        tx({ id: 3, postedOn: '2026-07-01', description: 'WSDOT 3', merchant: 'wsdot goodtogo', amountCents: -100 }),
        tx({ id: 4, postedOn: '2026-06-11', description: 'GEICO', merchant: 'Geico Auto', amountCents: -100 }),
      ],
    });
    expect(await ipc.countTransactions({ months: ['2026-05', '2026-06'] })).toBe(3);
    expect(await ipc.countTransactions({ merchants: ['wsdot goodtogo', 'geico auto'] })).toBe(4);
    expect(await ipc.countTransactions({ months: ['2026-05', '2026-06'], merchants: ['wsdot goodtogo'] })).toBe(2);
  });
});

describe('memory ipc transaction types', () => {
  const kinds = [
    { id: 10, groupId: 1, name: 'Groceries', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 0, archived: false },
    { id: 30, groupId: 1, name: 'Salary', emoji: null, color: null, budgetCents: null, excluded: false, kind: 'income' as const, sortOrder: 1, archived: false },
  ];
  const seed = () =>
    createMemoryIpc({
      categories: kinds.map((c) => ({ ...c })),
      transactions: [
        tx({ id: 1, postedOn: '2026-05-01', description: 'SAFEWAY', amountCents: -900, categoryId: 10, txType: 'regular' }),
        tx({ id: 2, postedOn: '2026-05-02', description: 'PAYROLL', amountCents: 300000, categoryId: 30, txType: 'income' }),
      ],
    });

  it('changes type and clears categories that do not fit', async () => {
    const ipc = seed();
    expect(await ipc.setTransactionType([1, 2], 'transfer')).toBe(2);
    const rows = await ipc.listTransactions({});
    expect(rows.map((t) => [t.txType, t.categoryId])).toEqual([['transfer', null], ['transfer', null]]);
  });

  it('keeps a fitting category', async () => {
    const ipc = seed();
    await ipc.setTransactionType([2], 'income');
    expect((await ipc.listTransactions({})).find((t) => t.id === 2)?.categoryId).toBe(30);
  });

  it('picking a category switches the type with it', async () => {
    const ipc = seed();
    await ipc.setTransactionCategory(1, 30);
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.txType).toBe('income');
    await ipc.bulkUpdateTransactions([1], { categoryId: 10 });
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.txType).toBe('regular');
  });

  it('filters by type', async () => {
    const ipc = seed();
    expect(await ipc.countTransactions({ types: ['income'] })).toBe(1);
  });
});

describe('memory ipc saved recurrings', () => {
  const netflix = (id: number, postedOn: string, amountCents = -1799) =>
    tx({ id, postedOn, description: 'NETFLIX.COM 866', merchant: 'netflix.com', amountCents, txType: 'regular' });
  const seed = () =>
    createMemoryIpc({
      transactions: [
        netflix(1, '2026-02-05'), netflix(2, '2026-03-05'), netflix(3, '2026-04-06'), netflix(4, '2026-05-05'),
        tx({ id: 10, postedOn: '2026-03-10', description: 'GEICO', merchant: 'geico auto', amountCents: -12000 }),
        tx({ id: 11, postedOn: '2026-04-10', description: 'GEICO', merchant: 'geico auto', amountCents: -12000 }),
        tx({ id: 12, postedOn: '2026-05-10', description: 'GEICO', merchant: 'geico auto', amountCents: -12000 }),
      ],
    });
  const rule = { name: 'Netflix', categoryId: null, matchKind: 'merchant' as const, pattern: 'netflix.com', minCents: 1500, maxCents: 2200, frequency: 'monthly' as const, dayOfMonth: 5 };

  it('saves detected bills on first read, with their charges linked', async () => {
    const ipc = seed();
    const list = await ipc.listRecurring(null);
    expect(list.map((r) => r.saved?.status)).toEqual(['active', 'active']);
    expect((await ipc.listTransactions({})).filter((t) => t.recurringId != null)).toHaveLength(7);
    expect(await ipc.recurringSuggestions(null)).toEqual([]);
  });

  it('creates, edits, pauses, deletes and unlinks', async () => {
    const ipc = seed();
    await ipc.listRecurring(null);
    for (const r of await ipc.listRecurring(null)) await ipc.deleteRecurring(r.saved!.id);
    expect(await ipc.previewRecurring(rule)).toBe(4);
    const id = await ipc.createRecurring(rule);
    expect((await ipc.listTransactions({})).filter((t) => t.recurringId === id)).toHaveLength(4);
    expect(await ipc.updateRecurring(id, { ...rule, minCents: 1800 })).toEqual({ added: 0, removed: 4 });
    await ipc.updateRecurring(id, rule);
    await ipc.setRecurringStatus(id, 'paused');
    expect((await ipc.listRecurring(null)).find((r) => r.saved?.id === id)?.saved?.status).toBe('paused');
    await ipc.unlinkRecurring(1);
    await ipc.updateRecurring(id, rule);
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.recurringId ?? null).toBeNull();
    await ipc.deleteRecurring(id);
    expect((await ipc.listTransactions({})).every((t) => t.recurringId == null)).toBe(true);
  });

  it('suggests detected bills that are not saved, until dismissed', async () => {
    const ipc = seed();
    await ipc.listRecurring(null);
    const geico = (await ipc.listRecurring(null)).find((r) => r.merchant === 'geico auto')!;
    await ipc.deleteRecurring(geico.saved!.id);
    expect((await ipc.recurringSuggestions(null)).map((r) => r.merchant)).toEqual(['geico auto']);
    await ipc.dismissSuggestion('geico auto');
    expect(await ipc.recurringSuggestions(null)).toEqual([]);
  });

  it('drafts a bill from a transaction', async () => {
    const ipc = seed();
    expect(await ipc.draftRecurring(4)).toMatchObject({ matchKind: 'merchant', pattern: 'netflix.com', minCents: 1439, maxCents: 2159, frequency: 'monthly', dayOfMonth: 5 });
  });

  it('filters by saved recurring', async () => {
    const ipc = seed();
    const [first] = await ipc.listRecurring(null);
    expect(await ipc.countTransactions({ recurringIds: [first.saved!.id] })).toBe(first.occurrences);
  });
});

describe('memory ipc recurrings match the core', () => {
  const charge = (id: number, postedOn: string, profileId = 1) =>
    tx({ id, profileId, postedOn, description: 'NETFLIX.COM 866', merchant: 'netflix.com', amountCents: -1799, txType: 'regular' });
  const rule = { name: 'Netflix', categoryId: null, matchKind: 'merchant' as const, pattern: 'netflix.com', minCents: 1500, maxCents: 2200, frequency: 'monthly' as const, dayOfMonth: 1 };

  it('measures the day window with real month lengths', async () => {
    const ipc = createMemoryIpc({ transactions: [charge(1, '2026-02-28'), charge(2, '2026-04-30')] });
    const id = await ipc.createRecurring(rule);
    expect((await ipc.listTransactions({})).map((t) => t.recurringId)).toEqual([id, id]);
  });

  it('unlinks a charge that becomes a transfer', async () => {
    const ipc = createMemoryIpc({ transactions: [charge(1, '2026-03-01')] });
    await ipc.createRecurring(rule);
    await ipc.setTransactionType([1], 'transfer');
    expect((await ipc.listTransactions({}))[0].recurringId ?? null).toBeNull();
  });

  it('a bill paid every few years is next due that many years on', async () => {
    for (const [frequency, next] of [['biennial', '2028-10-01'], ['triennial', '2029-10-01'], ['quadrennial', '2030-10-01']] as const) {
      const ipc = createMemoryIpc({ transactions: [charge(1, '2026-10-01')] });
      await ipc.createRecurring({ ...rule, frequency });
      expect((await ipc.listRecurring(null))[0].nextDate).toBe(next);
    }
  });

  it('a bill paid a few days early is next due a period after the date it paid', async () => {
    const ipc = createMemoryIpc({ transactions: [charge(1, '2026-10-01'), charge(2, '2026-10-30')] });
    await ipc.createRecurring(rule);
    expect((await ipc.listRecurring(null))[0].nextDate).toBe('2026-12-01');
    const late = createMemoryIpc({ transactions: [charge(1, '2026-10-03')] });
    await late.createRecurring(rule);
    expect((await late.listRecurring(null))[0].nextDate).toBe('2026-11-01');
  });

  it('shows a profile only the bills it pays', async () => {
    const ipc = createMemoryIpc({ transactions: [charge(1, '2026-03-01', 1)] });
    await ipc.createRecurring(rule);
    expect(await ipc.listRecurring(2)).toEqual([]);
    expect(await ipc.listRecurring(1)).toHaveLength(1);
  });
});

describe('memory ipc tags (mirror tags.rs)', () => {
  const seed = () => ({
    transactions: [
      tx({ id: 1, postedOn: '2026-05-01', description: 'UBER', amountCents: -1000 }),
      tx({ id: 2, postedOn: '2026-05-02', description: 'HOTEL', amountCents: -20000, reviewed: true }),
      tx({ id: 3, postedOn: '2026-05-03', description: 'COFFEE', amountCents: -500 }),
    ],
  });

  it('creates tags with trimmed names and rotating colors, refusing duplicates and empties', async () => {
    const ipc = createMemoryIpc(seed());
    const a = await ipc.createTag('  Vacation 2026 ');
    await ipc.createTag('Work');
    await ipc.createTag('Gift', '#123456');
    const tags = await ipc.listTags();
    expect(tags.map((t) => [t.id, t.name, t.color, t.count])).toEqual([
      [a, 'Vacation 2026', TAG_PALETTE[NEW_TAG_ORDER[0]], 0],
      [a + 1, 'Work', '#5cb85c', 0],
      [a + 2, 'Gift', '#123456', 0],
    ]);
    await expect(ipc.createTag(' work ')).rejects.toThrow();
    await expect(ipc.createTag('   ')).rejects.toThrow();
    await expect(ipc.createTag('x'.repeat(41))).rejects.toThrow();
  });

  it('renames and recolors, but not onto another tag name', async () => {
    const ipc = createMemoryIpc(seed());
    const a = await ipc.createTag('Work');
    await ipc.createTag('Trip');
    await ipc.updateTag(a, { name: 'Office', color: '#00ff00' });
    await ipc.updateTag(a, { name: 'OFFICE' });
    expect((await ipc.listTags())[0]).toMatchObject({ name: 'OFFICE', color: '#00ff00' });
    await expect(ipc.updateTag(a, { name: 'trip' })).rejects.toThrow();
  });

  it('adds and removes tags on rows, counts them, and filters by any tag', async () => {
    const ipc = createMemoryIpc(seed());
    const work = await ipc.createTag('Work');
    const trip = await ipc.createTag('Trip');
    expect(await ipc.addTags([1, 2], [trip, work])).toBe(4);
    expect(await ipc.addTags([1], [work])).toBe(0);
    expect(await ipc.removeTags([1], [work])).toBe(1);
    const rows = await ipc.listTransactions({});
    expect(rows.find((t) => t.id === 1)?.tagIds).toEqual([trip]);
    expect(rows.find((t) => t.id === 2)?.tagIds).toEqual([work, trip]);
    expect(rows.find((t) => t.id === 3)?.tagIds ?? []).toEqual([]);
    expect(rows.find((t) => t.id === 2)?.reviewed).toBe(true);
    expect((await ipc.listTags()).map((t) => t.count)).toEqual([1, 2]);
    expect((await ipc.listTransactions({ tagIds: [work, trip] })).map((t) => t.id)).toEqual([2, 1]);
    expect((await ipc.listTransactions({ tagIds: [work], text: 'uber' })).map((t) => t.id)).toEqual([]);
    expect(await ipc.countTransactions({ tagIds: [trip] })).toBe(2);
  });

  it('deleting a tag takes it off its rows', async () => {
    const ipc = createMemoryIpc(seed());
    const work = await ipc.createTag('Work');
    await ipc.addTags([1], [work]);
    await ipc.deleteTag(work);
    expect(await ipc.listTags()).toEqual([]);
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.tagIds ?? []).toEqual([]);
  });
});

describe('memory ipc budget plan (mirror budgets.rs)', () => {
  const seed = () => ({
    transactions: [tx({ id: 1, postedOn: '2026-11-05', description: 'WHOLE FOODS', amountCents: -5000, categoryId: 10 })],
  });

  it('stores month overrides, and a default for all months clears them', async () => {
    const ipc = createMemoryIpc(seed());
    await ipc.setBudget(10, null, 40000);
    await ipc.setBudget(10, '2026-12', 60000);
    expect((await ipc.getBudgetPlan()).months).toEqual([{ categoryId: 10, month: '2026-12', amountCents: 60000 }]);
    await ipc.setBudget(10, '2026-12', null);
    expect((await ipc.getBudgetPlan()).months).toEqual([]);
    await ipc.setBudget(10, '2027-01', 100);
    await ipc.setBudget(10, null, 45000);
    expect((await ipc.getBudgetPlan()).months).toEqual([]);
    expect((await ipc.listCategories()).find((c) => c.id === 10)?.budgetCents).toBe(45000);
    await expect(ipc.setBudget(10, null, -1)).rejects.toThrow();
    await expect(ipc.setBudget(10, '2026-13', 1)).rejects.toThrow();
  });

  it('keeps group budgets and rollovers, and month status follows the plan', async () => {
    const ipc = createMemoryIpc(seed());
    await ipc.setBudget(10, null, 40000);
    await ipc.setBudget(10, '2026-11', 50000);
    await ipc.setBudget(20, null, 10000);
    expect((await ipc.analyticsBudgets(null, '2026-11-10')).find((b) => b.categoryId === 10)?.budgetCents).toBe(50000);
    await ipc.setGroupBudget(1, 90000);
    await ipc.setRollover(20, '2026-10');
    const plan = await ipc.getBudgetPlan();
    expect(plan.groups).toEqual([{ groupId: 1, amountCents: 90000 }]);
    expect(plan.rollovers).toEqual([{ categoryId: 20, since: '2026-10' }]);
    // Groceries (10) is under group 1's shared budget now.
    expect((await ipc.analyticsBudgets(null, '2026-11-10')).map((b) => b.categoryId)).toEqual([20]);
  });

  it('saves a rebalance for this month or from now on, refusing one that changes the total', async () => {
    const ipc = createMemoryIpc(seed());
    await ipc.setBudget(10, null, 40000);
    await ipc.setBudget(20, null, 10000);
    await expect(ipc.applyRebalance([{ categoryId: 10, amountCents: 45000 }, { categoryId: 20, amountCents: 10000 }], 'thisMonth', '2026-11')).rejects.toThrow();
    await ipc.applyRebalance([{ categoryId: 10, amountCents: 43700 }, { categoryId: 20, amountCents: 6300 }], 'thisMonth', '2026-11');
    expect((await ipc.getBudgetPlan()).months).toEqual([
      { categoryId: 10, month: '2026-11', amountCents: 43700 },
      { categoryId: 20, month: '2026-11', amountCents: 6300 },
    ]);
    await ipc.applyRebalance([{ categoryId: 10, amountCents: 42000 }, { categoryId: 20, amountCents: 8000 }], 'fromNowOn', '2026-11');
    expect((await ipc.getBudgetPlan()).months).toEqual([]);
    expect((await ipc.listCategories()).map((c) => c.budgetCents)).toEqual([42000, 8000]);
  });
});
