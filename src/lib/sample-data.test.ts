import { describe, expect, it } from 'vitest';
import { sampleSeed } from './sample-data';

const TODAY = new Date(2026, 10, 21); // Nov 21, 2026

describe('sampleSeed', () => {
  const seed = sampleSeed(TODAY);
  const txs = seed.transactions ?? [];
  const catIds = new Set((seed.categories ?? []).map((c) => c.id));
  const groupIds = new Set((seed.groups ?? []).map((g) => g.id));
  const sourceIds = new Set((seed.sources ?? []).map((s) => s.id));

  it('is deterministic for a given day', () => {
    expect(sampleSeed(TODAY)).toEqual(seed);
  });

  it('spans more than a year up to today and never later', () => {
    const days = txs.map((t) => t.postedOn).sort();
    expect(days[0] <= '2025-11-01').toBe(true);
    expect(days[days.length - 1]).toBe('2026-11-21');
    expect(txs.length).toBeGreaterThan(400);
  });

  it('only references categories, groups and sources that exist', () => {
    for (const t of txs) {
      expect(sourceIds.has(t.sourceId)).toBe(true);
      if (t.categoryId != null) expect(catIds.has(t.categoryId)).toBe(true);
    }
    for (const c of seed.categories ?? []) expect(groupIds.has(c.groupId)).toBe(true);
  });

  it('has unique transaction ids and integer cents', () => {
    expect(new Set(txs.map((t) => t.id)).size).toBe(txs.length);
    for (const t of txs) expect(Number.isInteger(t.amountCents)).toBe(true);
  });

  it('leaves recent transactions to review and includes income', () => {
    expect(txs.filter((t) => !t.reviewed).length).toBeGreaterThanOrEqual(5);
    expect(txs.some((t) => t.amountCents > 0)).toBe(true);
  });

  it('has monthly recurring bills', () => {
    const rent = txs.filter((t) => t.merchant === 'Rent');
    expect(rent.length).toBeGreaterThanOrEqual(12);
  });

  it("gives each row its category's type, so paychecks are income and card payments transfers", () => {
    const kindOf = new Map((seed.categories ?? []).map((c) => [c.id, c.kind]));
    for (const t of txs) {
      const kind = t.categoryId == null ? 'expense' : kindOf.get(t.categoryId);
      expect(t.txType).toBe(kind === 'income' ? 'income' : kind === 'transfer' ? 'transfer' : 'regular');
    }
  });
});

