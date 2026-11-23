import { describe, expect, it } from 'vitest';
import { builtinRates } from './fx';
import { createMemoryIpc } from './ipc';
import type { Transaction } from './types';

// Mirrors crates/core/tests/fx_builtin_test.rs and fx_display_test.rs for the in-memory IPC (tests and the preview).
const r = builtinRates();
const tx = (id: number, postedOn: string, cents: number): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn, description: `SHELL ${id}`, merchant: 'shell', amountCents: cents, currency: 'USD',
  categoryId: 10, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const inr = (month: string, usd: number) => Math.round(usd * r.rate('USD', 'INR', month)!);

describe('built-in rates (mirror)', () => {
  it('go through the euro, and months outside the data use the nearest', () => {
    expect(r.rate('USD', 'INR', '2026-10')).toBeCloseTo(r.perEuro('INR', '2026-10')! / r.perEuro('USD', '2026-10')!, 9);
    expect(r.rate('INR', 'INR', '2026-10')).toBe(1);
    expect(r.rate('USD', 'INR', '2099-01')).toBe(r.rate('USD', 'INR', r.latestMonth()));
    expect(r.rate('USD', 'INR', '1995-03')).toBe(r.rate('USD', 'INR', '2000-01'));
    expect(r.currencies()).toContain('INR');
    expect(r.currencies()).toContain('EUR');
  });
});

describe('memory IPC in another display currency', () => {
  const setup = async () => {
    const ipc = createMemoryIpc({ transactions: [tx(1, '2025-01-10', -10_000), tx(2, '2026-10-10', -10_000)] });
    await ipc.setSetting('display_currency', 'INR');
    return ipc;
  };

  it('shows transactions converted at their month, keeping the original', async () => {
    const ipc = await setup();
    const rows = (await ipc.listTransactions({})).sort((a, b) => a.id - b.id);
    expect(rows.map((t) => [t.amountCents, t.currency, t.originalAmountCents, t.originalCurrency])).toEqual([
      [inr('2025-01', -10_000), 'INR', -10_000, 'USD'],
      [inr('2026-10', -10_000), 'INR', -10_000, 'USD'],
    ]);
    const months = await ipc.analyticsMonthly(null, 'all', '2026-11-22');
    expect(months.map((m) => m.expenseCents)).toEqual([inr('2025-01', 10_000), inr('2026-10', 10_000)]);
  });

  it('a budget typed in rupees shows exactly, and switching back converts it', async () => {
    const ipc = await setup();
    await ipc.setBudget(10, null, 4_000_000);
    expect((await ipc.listCategories()).find((c) => c.id === 10)?.budgetCents).toBe(4_000_000);
    expect(await ipc.getSetting('budget_currency')).toBe('INR');
    await ipc.setSetting('display_currency', 'USD');
    const back = (await ipc.listCategories()).find((c) => c.id === 10)?.budgetCents;
    expect(back).toBe(Math.round(4_000_000 / r.rate('USD', 'INR', r.latestMonth())!));
    expect((await ipc.listTransactions({}))[0].originalAmountCents ?? null).toBeNull();
  });
});
