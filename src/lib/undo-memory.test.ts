import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

// Mirrors crates/core/tests/undo_test.rs and the command labels (src-tauri/src/commands.rs undo_tests).
const tx = (id: number, description: string, amountCents: number, categoryId: number | null = null): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn: `2026-11-0${id}`, description, merchant: description.toLowerCase(), amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: false, notes: null, refundOf: null,
});
const setup = () =>
  createMemoryIpc({
    transactions: [tx(1, 'UBER', -1200), tx(2, 'UBER', -1500), tx(3, 'WHOLE FOODS', -6418, 10)],
    imports: [{ id: 1, sourceId: 1, sourceName: 'Visa', fileName: 'nov.csv', importedAt: '2026-11-20T10:00:00Z', importedRows: 3, skippedRows: 0, transactionIds: [1, 2, 3] }],
  });
const rows = async (ipc: ReturnType<typeof setup>) => (await ipc.listTransactions({})).map((t) => [t.id, t.categoryId, t.reviewed] as const).sort((a, b) => a[0] - b[0]);

describe('memory IPC undo and redo', () => {
  it('undoes and redoes a change, with labels for the Edit menu', async () => {
    const ipc = setup();
    const before = await rows(ipc);
    expect(await ipc.undoState()).toEqual({ undo: null, redo: null });
    await ipc.setTransactionCategory(1, 11);
    expect(await ipc.undoState()).toEqual({ undo: 'Change Category', redo: null });
    expect(await ipc.undo()).toBe('Change Category');
    expect(await rows(ipc)).toEqual(before);
    expect(await ipc.undoState()).toEqual({ undo: null, redo: 'Change Category' });
    expect(await ipc.redo()).toBe('Change Category');
    expect((await rows(ipc))[0][1]).toBe(11);
    expect(await ipc.redo()).toBeNull();
  });

  it('one step per action, even when it calls others (Undo import deletes rows)', async () => {
    const ipc = setup();
    await ipc.undoImport(1);
    expect(await ipc.listTransactions({})).toEqual([]);
    expect(await ipc.undoState()).toEqual({ undo: 'Undo Import nov.csv', redo: null });
    await ipc.undo();
    expect((await ipc.listTransactions({})).length).toBe(3);
    expect((await ipc.listImports()).length).toBe(1);
    expect(await ipc.undo()).toBeNull();
  });

  it('labels count rows like the app', async () => {
    const ipc = setup();
    await ipc.applyRecategorize([1, 2], 11);
    expect((await ipc.undoState()).undo).toBe('Change Category of 2 Transactions');
    await ipc.bulkUpdateTransactions([1, 2], { reviewed: false });
    expect((await ipc.undoState()).undo).toBe('Mark 2 Transactions Unreviewed');
    await ipc.deleteTransactions([1, 2]);
    expect((await ipc.undoState()).undo).toBe('Delete 2 Transactions');
  });

  it('keeps 15 steps, and a new change clears redo', async () => {
    const ipc = setup();
    for (let i = 0; i < 17; i++) await ipc.updateTransaction(1, { notes: `n${i}` });
    let undone = 0;
    while ((await ipc.undo()) != null) undone++;
    expect(undone).toBe(15);
    expect((await ipc.listTransactions({})).find((t) => t.id === 1)?.notes).toBe('n1');
    await ipc.redo();
    await ipc.setTransactionCategory(2, 11);
    expect((await ipc.undoState()).redo).toBeNull();
  });
});
