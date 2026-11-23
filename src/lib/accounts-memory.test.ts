import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { Source, Transaction } from './types';

// Mirrors crates/core/tests/accounts_test.rs (moving an import, default tags, clues).
const src = (id: number, name: string): Source => ({ id, profileId: 1, name, kind: 'csv', institution: 'Chase', currency: 'USD' });
const tx = (id: number, sourceId: number, postedOn: string, description: string, amountCents: number): Transaction => ({
  id, profileId: 1, sourceId, postedOn, description, merchant: description.toLowerCase(), amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const setup = () =>
  createMemoryIpc({
    sources: [src(1, 'Freedom'), src(2, 'Sapphire')],
    transactions: [tx(1, 2, '2026-11-03', 'UBER TRIP', -1200), tx(2, 1, '2026-11-03', 'UBER TRIP', -1200), tx(3, 1, '2026-11-05', 'SHELL', -4000)],
    imports: [{ id: 7, sourceId: 1, sourceName: 'Freedom', fileName: 'nov.csv', importedAt: '2026-11-20T10:00:00Z', importedRows: 2, skippedRows: 0, transactionIds: [2, 3] }],
    accountClues: [{ id: 1, sourceId: 1, kind: 'layout', value: 'csv:amount|date|description' }],
    tags: [{ id: 9, name: 'Business', color: '#ddb24a' }],
  });

describe('memory IPC accounts', () => {
  it('moves an import, dropping rows the account already has, as one undoable step', async () => {
    const ipc = setup();
    expect(await ipc.moveImport(7, 2)).toEqual({ moved: 1, dropped: 1 });
    const rows = await ipc.listTransactions({});
    expect(rows.map((t) => [t.id, t.sourceId]).sort()).toEqual([[1, 2], [3, 2]]);
    expect((await ipc.listImports())[0].sourceName).toBe('Sapphire');
    expect((await ipc.undoState()).undo).toBe('Move nov.csv to Sapphire');
    await ipc.undo();
    expect((await ipc.listTransactions({})).length).toBe(3);
  });

  it('a default tag goes on existing rows only when asked, and clearing it untags nothing', async () => {
    const ipc = setup();
    expect(await ipc.setAccountDefaultTag(1, 9, false)).toBe(0);
    expect(await ipc.setAccountDefaultTag(1, 9, true)).toBe(2);
    await ipc.setAccountDefaultTag(1, null, true);
    const tagged = (await ipc.listTransactions({})).filter((t) => t.tagIds?.includes(9)).map((t) => t.id);
    expect(tagged.sort()).toEqual([2, 3]);
    expect((await ipc.listSources()).find((s) => s.id === 1)?.defaultTagId ?? null).toBeNull();
  });

  it('lists and forgets what an account is recognized by', async () => {
    const ipc = setup();
    expect(await ipc.accountClues(1)).toEqual([{ id: 1, kind: 'layout', value: 'csv:amount|date|description' }]);
    await ipc.forgetAccountClue(1);
    expect(await ipc.accountClues(1)).toEqual([]);
  });
});

describe('memory IPC CSV import (preview)', () => {
  const file = 'Transaction Date,Description,Amount\n2026-11-03,UBER TRIP,-12.00\n2026-11-05,SHELL,-40.00\n';
  it('asks which account, imports into a new one, then recognizes the next file', async () => {
    const ipc = createMemoryIpc({ sources: [src(1, 'Freedom')] });
    const first = await ipc.importCsvText(1, 'Chase7781_Activity.csv', file);
    expect(first.needsAccount?.suggestedName).toBe('Chase ••7781');
    expect(first.needsAccount?.preview).toMatchObject({ rows: 2, first: '2026-11-03', last: '2026-11-05' });
    const done = await ipc.importCsvText(1, 'Chase7781_Activity.csv', file, {
      kind: 'new', account: { name: 'Sapphire', institution: 'Chase', accountType: 'card', color: null, defaultTagId: null }, remember: true,
    });
    expect([done.sourceName, done.inserted]).toEqual(['Sapphire', 2]);
    const next = await ipc.importCsvText(1, 'Chase7781_Activity (1).csv', 'Transaction Date,Description,Amount\n2026-12-01,TARGET,-25.00\n');
    expect([next.needsAccount ?? null, next.sourceName, next.inserted]).toEqual([null, 'Sapphire', 1]);
  });
});
