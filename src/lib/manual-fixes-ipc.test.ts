import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

let id = 1;
const tx = (postedOn: string, description: string, amountCents: number): Transaction => ({
  id: id++, profileId: 1, sourceId: 1, postedOn, description, merchant: description.toLowerCase(), amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});

describe('memory IPC manual fixes (mirrors transactions::delete_many and imports.rs)', () => {
  it('deletes transactions and clears refund links to them', async () => {
    const a = tx('2026-11-01', 'COFFEE', -450);
    const b = { ...tx('2026-11-02', 'COFFEE REFUND', 450), refundOf: a.id };
    const c = tx('2026-11-03', 'TRADER JOES', -6210);
    const ipc = createMemoryIpc({ transactions: [a, b, c] });
    expect(await ipc.deleteTransactions([a.id, c.id])).toBe(2);
    const left = await ipc.listTransactions({});
    expect(left.map((t) => t.id)).toEqual([b.id]);
    expect(left[0].refundOf).toBeNull();
  });

  it('lists imports newest first with what remains, and undo removes only what an import added', async () => {
    const early = [tx('2026-11-01', 'COFFEE', -450), tx('2026-11-03', 'TRADER JOES', -6210)];
    const late = [tx('2026-11-20', 'SHELL OIL', -4827)];
    const ipc = createMemoryIpc({
      transactions: [...early, ...late],
      imports: [
        { id: 1, sourceId: 1, sourceName: 'Amex', fileName: 'nov-1.csv', importedAt: '2026-11-18T10:00:00Z', importedRows: 2, skippedRows: 0, transactionIds: early.map((t) => t.id) },
        { id: 2, sourceId: 1, sourceName: 'Amex', fileName: 'nov-all.csv', importedAt: '2026-11-22T10:00:00Z', importedRows: 1, skippedRows: 2, transactionIds: late.map((t) => t.id) },
      ],
    });
    const list = await ipc.listImports();
    expect(list.map((i) => [i.fileName, i.remaining])).toEqual([['nov-all.csv', 1], ['nov-1.csv', 2]]);
    expect(await ipc.undoImport(2)).toBe(1);
    expect((await ipc.listTransactions({})).map((t) => t.description).sort()).toEqual(['COFFEE', 'TRADER JOES']);
    expect((await ipc.listImports()).map((i) => i.id)).toEqual([1]);
  });
});
