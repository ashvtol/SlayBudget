import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { DuplicateFlag, Transaction } from './types';

// Mirrors crates/core/tests/duplicates_test.rs (resolve and delete); detection only runs in the app.
const tx = (id: number, description: string, amountCents: number, tagIds: number[] = []): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn: '2026-11-18', description, merchant: 'shake shack', amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, tagIds,
});
const flag = (id: number, txId: number, otherId: number): DuplicateFlag => ({
  id, txId, otherId, importId: 2, confidence: 'likely', reason: 'Same place a day apart as SHAKE SHACK 123 on Nov 17 ($30.31); the amount changed by $6.00 (a tip?).',
  createdAt: '2026-11-22T10:00:00Z', resolvedAt: null, resolution: null,
});
const TAG = { id: 7, name: 'Possible duplicate', color: '#ddb24a' };
const setup = () =>
  createMemoryIpc({
    tags: [TAG],
    transactions: [tx(1, 'SHAKE SHACK 123', -3031), tx(2, 'SHAKE SHACK 123', -3631, [7]), tx(3, 'BLUE BOTTLE', -500), tx(4, 'BLUE BOTTLE SF', -500, [7])],
    duplicateFlags: [flag(1, 2, 1), flag(2, 4, 3)],
  });
const ids = async (ipc: ReturnType<typeof setup>) => (await ipc.listTransactions({})).map((t) => t.id).sort();
const tagsOf = async (ipc: ReturnType<typeof setup>, id: number) => (await ipc.listTransactions({})).find((t) => t.id === id)?.tagIds ?? [];

describe('memory IPC possible duplicates', () => {
  it('finds the open flag from either row of the pair', async () => {
    const ipc = setup();
    expect((await ipc.duplicateFlagFor(2))?.id).toBe(1);
    expect((await ipc.duplicateFlagFor(1))?.id).toBe(1);
    expect(await ipc.duplicateFlagFor(99)).toBeNull();
  });

  it('not a duplicate keeps both and takes the tag off only that row', async () => {
    const ipc = setup();
    await ipc.resolveDuplicate(1, 'kept');
    expect(await ipc.duplicateFlagFor(2)).toBeNull();
    expect(await tagsOf(ipc, 2)).toEqual([]);
    expect(await tagsOf(ipc, 4)).toEqual([7]);
    expect(await ids(ipc)).toEqual([1, 2, 3, 4]);
  });

  it('delete the other one removes the existing row and untags the new one', async () => {
    const ipc = setup();
    await ipc.resolveDuplicate(1, 'other_deleted');
    expect(await ids(ipc)).toEqual([2, 3, 4]);
    expect(await tagsOf(ipc, 2)).toEqual([]);
    expect(await ipc.duplicateFlagFor(2)).toBeNull();
  });

  it('delete this one, or deleting it from anywhere, resolves the flag', async () => {
    const ipc = setup();
    await ipc.resolveDuplicate(1, 'deleted');
    expect(await ids(ipc)).toEqual([1, 3, 4]);
    expect(await ipc.duplicateFlagFor(1)).toBeNull();
    await ipc.deleteTransactions([3]);
    expect(await ipc.duplicateFlagFor(4)).toBeNull();
    expect(await tagsOf(ipc, 4)).toEqual([]);
  });
});
