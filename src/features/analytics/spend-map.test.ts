import { describe, expect, it } from 'vitest';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { buildSpendMap, labelPlan, previousWindow, spendMapOption } from './spend-map';

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

describe('spendMapOption', () => {
  const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };
  it('builds a two-level treemap with tiles colored by change', () => {
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      series: { type: string; data: { name: string; value: number; children?: { name: string; value: number; itemStyle: { color: string } }[] }[] }[];
    };
    const series = option.series[0];
    expect(series.type).toBe('treemap');
    const food = series.data.find((d) => d.name === 'Food & Drink')!;
    const [restaurants, groceries] = food.children!;
    expect(restaurants.value).toBe(9000);
    expect(restaurants.itemStyle.color).not.toBe(groceries.itemStyle.color);
    // Rising spend leans red, falling leans green, new uses the accent.
    expect(restaurants.itemStyle.color).toContain('e34e3a');
    expect(groceries.itemStyle.color).toContain('57bd57');
    const rent = series.data.find((d) => d.name === 'Home')!.children![0];
    expect(rent.itemStyle.color).toContain('77a5f2');
  });

  it('lays the tooltip out like the other charts: heading, then label and value rows', () => {
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      tooltip: { formatter: (p: { data: unknown }) => string; backgroundColor?: string };
      series: { data: { name: string; children?: unknown[] }[] }[];
    };
    // The same default card as the Cash flow and Dashboard charts (no custom colors).
    expect(option.tooltip.backgroundColor).toBeUndefined();
    const restaurants = option.series[0].data.find((d) => d.name === 'Food & Drink')!.children![0];
    const html = option.tooltip.formatter({ data: restaurants });
    const rows = [...html.matchAll(/data-row="([^"]+)"[^>]*>(.*?)<\/div>/g)].map((m) => [m[1], m[2].replace(/<[^>]+>/g, '').trim()]);
    expect(html).toMatch(/Restaurants/);
    expect(rows).toEqual([
      ['Spent', 'Spent$90.00'],
      ['Share', 'Share4.2%'],
      ['vs previous period', 'vs previous period+$45.00 (+100%)'],
      ['Transactions', 'Transactions4'],
      ['Average', 'Average$22.50'],
      ['Din Tai', 'Din Tai$90.00'],
    ]);
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

  it('puts merchants under each category tile and drills one level at a time', () => {
    const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      series: { leafDepth: number; data: { name: string; children?: { name: string; children?: { name: string; value: number }[] }[] }[] }[];
    };
    expect(option.series[0].leafDepth).toBe(2);
    const restaurants = option.series[0].data.find((d) => d.name === 'Food & Drink')!.children![0];
    expect(restaurants.children!.map((m) => [m.name, m.value])).toEqual([['Din Tai', 9000]]);
  });
});

describe('spending map resets its zoom when categories are hidden', () => {
  const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };
  it('names the series after the hidden set, so a change starts from the top', () => {
    const a = spendMapOption(build(), tokens, { compare: true, animate: false, hiddenKey: '' }) as unknown as { series: { id: string }[] };
    const b = spendMapOption(build(), tokens, { compare: true, animate: false, hiddenKey: '99' }) as unknown as { series: { id: string }[] };
    expect(a.series[0].id).not.toBe(b.series[0].id);
  });
});

describe('spending map animation', () => {
  it('reshapes in 0.3 s, or not at all when motion is reduced', () => {
    const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };
    const on = spendMapOption(build(), tokens, { compare: true, animate: true }) as { animationDurationUpdate?: number; animation?: boolean };
    expect(on.animationDurationUpdate).toBe(300);
    const off = spendMapOption(build(), tokens, { compare: true, animate: false }) as { animationDurationUpdate?: number; animation?: boolean };
    expect(off.animation).toBe(false);
  });
});

describe('spendMapOption clicks', () => {
  const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };
  it('opens a category on click but does not zoom into a single merchant tile', () => {
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      series: { nodeClick: unknown; leafDepth: number; data: { children?: { children?: { link?: string }[] }[] }[] }[];
    };
    const s = option.series[0];
    // ECharts drills into a category (a leaf root at leafDepth 2) whatever nodeClick is;
    // 'link' with no links makes a merchant click do nothing instead of zooming into one tile.
    expect(s.leafDepth).toBe(2);
    expect(s.nodeClick).toBe('link');
    const merchants = s.data.flatMap((g) => g.children ?? []).flatMap((c) => c.children ?? []);
    expect(merchants.length).toBeGreaterThan(0);
    expect(merchants.every((m) => m.link == null)).toBe(true);
  });
});

describe('spend map labels', () => {
  const tokens = { pos: '#57bd57', neg: '#e34e3a', accent: '#77a5f2', muted: '#8a97ad', panel: '#06101a', text: '#ffffff' };

  it('sets the name and a bold amount apart, with room between them', () => {
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      series: { label: { formatter: (p: unknown) => string; rich: Record<string, { fontWeight?: string; lineHeight?: number; fontSize?: number }> } }[];
    };
    const label = option.series[0].label;
    expect(label.formatter({ data: { name: 'Fuel', value: 31215, tile: { emoji: '⛽' } } })).toBe('{name|⛽ Fuel}\n{amount|$312.15}');
    expect(label.rich.amount.fontWeight).toBe('bold');
    expect(label.rich.amount.fontSize).toBeGreaterThan(12);
    expect(label.rich.name.lineHeight).toBeGreaterThanOrEqual(20);
  });

  it('keeps labels centred in their tiles and group headings as plain names', () => {
    const option = spendMapOption(build(), tokens, { compare: true, animate: false }) as unknown as {
      series: { label: { position: string; align: string; verticalAlign: string; rich: Record<string, { align?: string }> }; levels: { upperLabel?: { show?: boolean; formatter?: unknown } }[] }[];
    };
    const s = option.series[0];
    expect([s.label.position, s.label.align, s.label.verticalAlign]).toEqual(['inside', 'center', 'middle']);
    expect([s.label.rich.name.align, s.label.rich.amount.align]).toEqual(['center', 'center']);
    // Group headings use their own plain formatter, not the tile's rich one.
    expect(s.levels[1].upperLabel?.formatter).toBe('{b}');
  });

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
