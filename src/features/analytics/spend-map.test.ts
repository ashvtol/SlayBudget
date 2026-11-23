import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { buildSpendMap, labelPlan, previousWindow } from './spend-map';

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 0 },
  { id: 2, name: 'Home', emoji: '🏠', color: '#4c85ee', sortOrder: 1 },
];
const cat = (id: number, groupId: number, name: string, extra: Partial<Category> = {}): Category => ({
  id, groupId, name, emoji: '•', color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, ...extra,
});
const categories = [
  cat(10, 1, 'Restaurants'),
  cat(11, 1, 'Groceries'),
  cat(20, 2, 'Rent'),
  cat(30, 2, 'Card Payment', { excluded: true }),
  cat(40, 2, 'Salary', { kind: 'income' }),
];
let id = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number | null, merchant = 'm', txType: Transaction['txType'] = 'regular'): Transaction => ({
  id: id++, profileId: 1, sourceId: 1, postedOn, description: merchant.toUpperCase(), merchant, amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

// Current window: Nov 1 - Nov 30 (30 days); previous: Oct 2 - Oct 31.
const window = { from: '2026-11-01', to: '2026-11-30' };
const txs = [
  tx('2026-11-03', -6000, 10, 'din tai'),
  tx('2026-11-05', -3000, 10, 'din tai'),
  tx('2026-11-09', -1000, 10, 'sushi bar'),
  tx('2026-11-10', 1000, 10, 'sushi bar'), // refund
  tx('2026-11-12', -5000, 11, 'safeway'),
  tx('2026-11-01', -200000, 20, 'landlord'),
  tx('2026-11-02', -40000, 30, 'amex'), // excluded category
  tx('2026-11-04', 300000, 40, 'payroll', 'income'),
  tx('2026-11-06', -9999, null, 'citi autopay', 'transfer'),
  tx('2026-11-07', -700, null, 'mystery'),
  tx('2026-10-10', -4500, 10, 'din tai'), // previous period
  tx('2026-10-11', -10000, 11, 'safeway'),
  tx('2026-10-01', -200000, 20, 'landlord'), // before previous window
];
const build = () => buildSpendMap({ transactions: txs, categories, groups, window, previous: previousWindow(window) });

describe('previousWindow', () => {
  it('is the same length immediately before', () => {
    expect(previousWindow(window)).toEqual({ from: '2026-10-02', to: '2026-10-31' });
  });
  it('is null for all time', () => {
    expect(previousWindow({ from: null, to: null })).toBeNull();
  });
});

describe('buildSpendMap', () => {
  it('sums Regular spending by group and category, net of refunds, leaving out excluded, income and transfers', () => {
    const m = build();
    expect(m.totalCents).toBe(9000 + 5000 + 200000 + 700);
    const food = m.groups.find((g) => g.name === 'Food & Drink')!;
    expect(food.valueCents).toBe(14000);
    expect(food.children.map((c) => [c.name, c.valueCents])).toEqual([['Restaurants', 9000], ['Groceries', 5000]]);
    expect(m.groups.flatMap((g) => g.children).some((c) => c.name === 'Card Payment' || c.name === 'Salary')).toBe(false);
    expect(m.groups.find((g) => g.name === 'Uncategorized')?.valueCents).toBe(700);
  });

  it('compares with the previous period', () => {
    const food = build().groups.find((g) => g.name === 'Food & Drink')!;
    const [restaurants, groceries] = food.children;
    expect(restaurants).toMatchObject({ previousCents: 4500, changePct: 100 });
    expect(groceries).toMatchObject({ previousCents: 10000, changePct: -50 });
    const rent = build().groups.find((g) => g.name === 'Home')!.children[0];
    expect(rent.previousCents).toBe(0);
    expect(rent.changePct).toBeNull(); // new this period
  });

  it('details each category: count, average, share and top merchants', () => {
    const m = build();
    const restaurants = m.groups.find((g) => g.name === 'Food & Drink')!.children[0];
    expect(restaurants.count).toBe(4);
    expect(restaurants.avgCents).toBe(2250);
    expect(restaurants.share).toBeCloseTo(9000 / m.totalCents);
    expect(restaurants.topMerchants).toEqual([
      { name: 'Din Tai', cents: 9000 },
      { name: 'Sushi Bar', cents: 0 },
    ]);
  });

  it('orders groups by size and hides categories at or below zero', () => {
    const m = buildSpendMap({ transactions: [tx('2026-11-03', 500, 10), tx('2026-11-04', -100, 20)], categories, groups, window, previous: null });
    expect(m.groups.map((g) => g.name)).toEqual(['Home']);
    expect(m.groups[0].children[0].changePct).toBeNull();
  });
});

describe('comparing only with full history', () => {
  it('does not compare when the data starts partway into the previous period', () => {
    const late = [tx('2026-10-25', -1000, 10), tx('2026-11-05', -3000, 10)];
    const m = buildSpendMap({ transactions: late, categories, groups, window, previous: previousWindow(window), dataStart: '2026-10-25' });
    expect(m.compared).toBe(false);
    expect(m.groups[0].children[0].changePct).toBeNull();
  });

  it('compares when the data covers the previous period', () => {
    const m = buildSpendMap({ transactions: txs, categories, groups, window, previous: previousWindow(window), dataStart: '2025-01-01' });
    expect(m.compared).toBe(true);
  });
});

describe('spending map V2', () => {
  it('breaks a category down by merchant with visits and change', () => {
    const restaurants = build().groups.find((g) => g.name === 'Food & Drink')!.children[0];
    expect(restaurants.merchants).toEqual([
      { name: 'Din Tai', cents: 9000, count: 2, previousCents: 4500, changePct: 100 },
      { name: 'Sushi Bar', cents: 0, count: 2, previousCents: 0, changePct: null },
    ]);
  });

  it('hides chosen categories and says how much was hidden', () => {
    const m = buildSpendMap({ transactions: txs, categories, groups, window, previous: previousWindow(window), hidden: new Set(['20', 'none']) });
    expect(m.groups.map((g) => g.name)).toEqual(['Food & Drink']);
    expect(m.totalCents).toBe(14000);
    expect(m.hiddenCents).toBe(200700);
    expect(m.hiddenNames).toEqual(['Rent', 'Uncategorized']);
    expect(m.groups[0].children[0].share).toBeCloseTo(9000 / 14000);
  });

});

describe('spend map labels', () => {
  it('plans each label for its tile: full, one line, vertical, or left to truncate', () => {
    // Plenty of room.
    expect(labelPlan(200, 120, '🍜 Restaurants')).toBe('full');
    // Wide but short: name and amount on one line, or just the name.
    expect(labelPlan(220, 26, '🛒 Groceries')).toBe('inline');
    expect(labelPlan(110, 26, '🛒 Groceries')).toBe('name');
    // Tall and narrow: turn it on its side.
    expect(labelPlan(60, 180, '💅 Personal Care')).toBe('vertical');
    expect(labelPlan(26, 180, '💅 Personal Care')).toBe('verticalName');
    // Too small either way: ECharts truncates as before.
    expect(labelPlan(30, 30, '💅 Personal Care')).toBe('squeezed');
    // A short name still needs room for the drill-in arrow and a wide emoji: Phone in a 74px tile.
    expect(labelPlan(74, 264, '📱 Phone')).toBe('vertical');
  });
});
