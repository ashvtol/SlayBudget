import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpendMap, SpendTile } from '@/features/analytics/spend-map';
import { layoutSpendMap, SpendTreemap } from './treemap';

afterEach(() => cleanup());

const tile = (name: string, groupName: string, valueCents: number, previousCents: number, merchants: [string, number][] = []): SpendTile => ({
  categoryId: name.length,
  name,
  emoji: name === 'Groceries' ? '🥑' : null,
  groupName,
  color: '#57bd57',
  valueCents,
  previousCents,
  changePct: previousCents > 0 ? Math.round(((valueCents - previousCents) / previousCents) * 100) : null,
  count: 4,
  avgCents: Math.round(valueCents / 4),
  share: valueCents / 100000,
  topMerchants: merchants.slice(0, 3).map(([n, c]) => ({ name: n, cents: c })),
  merchants: merchants.map(([n, c]) => ({ name: n, cents: c, count: 2, previousCents: 0, changePct: null })),
});

const map: SpendMap = {
  totalCents: 100000,
  compared: true,
  hiddenCents: 0,
  hiddenNames: [],
  groups: [
    {
      name: 'Home',
      color: '#4c85ee',
      valueCents: 60000,
      previousCents: 60000,
      children: [tile('Rent', 'Home', 60000, 60000)],
    },
    {
      name: 'Food & Drink',
      color: '#e8743b',
      valueCents: 40000,
      previousCents: 20000,
      children: [
        tile('Groceries', 'Food & Drink', 30000, 10000, [['Whole Foods', 20000], ['Trader Joes', 10000]]),
        tile('Restaurants', 'Food & Drink', 10000, 10000, [['Chipotle', 10000]]),
      ],
    },
  ],
};

const area = (t: { w: number; h: number }) => t.w * t.h;

describe('layoutSpendMap', () => {
  it('groups with a header strip, categories inside them, sized by spending', () => {
    const tiles = layoutSpendMap(map, { width: 600, height: 300, focus: null });
    const groups = tiles.filter((t) => t.level === 'group');
    const cats = tiles.filter((t) => t.level === 'category');
    expect(groups.map((g) => g.name)).toEqual(['Home', 'Food & Drink']);
    expect(cats.map((c) => c.name)).toEqual(['Rent', 'Groceries', 'Restaurants']);
    const food = groups[1];
    for (const c of cats.slice(1)) {
      expect(c.y).toBeGreaterThanOrEqual(food.y + 20 - 0.01); // below the group's name
      expect(c.x + c.w).toBeLessThanOrEqual(food.x + food.w + 0.01);
    }
    const ratio = area(cats[1]) / area(cats[2]);
    expect(ratio).toBeGreaterThan(2.6);
    expect(ratio).toBeLessThan(3.4);
  });

  it('a category opened: its merchants fill the map', () => {
    const tiles = layoutSpendMap(map, { width: 600, height: 300, focus: 'Food & Drink/Groceries' });
    expect(tiles.every((t) => t.level === 'merchant')).toBe(true);
    expect(tiles.map((t) => t.name)).toEqual(['Whole Foods', 'Trader Joes']);
    const total = tiles.reduce((s, t) => s + area(t), 0);
    expect(total).toBeGreaterThan(600 * 300 * 0.95);
  });

  it('every tile keeps the same key between layouts, so tiles can glide to their new places', () => {
    const a = layoutSpendMap(map, { width: 600, height: 300, focus: null }).map((t) => t.key);
    const b = layoutSpendMap(map, { width: 900, height: 400, focus: null }).map((t) => t.key);
    expect(b).toEqual(a);
  });
});

describe('SpendTreemap', () => {
  const draw = () => render(<SpendTreemap map={map} compared width={600} height={300} />);
  const mapGroup = () => screen.getByRole('group', { name: /Spending map/ });

  it('shows group names and category tiles with their name and amount, colored by change', () => {
    draw();
    expect(within(mapGroup()).getByText('Home')).toBeInTheDocument();
    const groceries = within(mapGroup()).getByRole('button', { name: /Groceries/ });
    expect(groceries).toHaveTextContent('🥑 Groceries');
    expect(groceries).toHaveTextContent('$300.00');
    // Spending tripled: a strong red; Rent didn't change: muted.
    expect(groceries.style.background).not.toBe(within(mapGroup()).getByRole('button', { name: /Rent/ }).style.background);
  });

  it('hovering a tile shows a dark card with what was spent, the share, the change and the top merchants', () => {
    draw();
    fireEvent.pointerMove(within(mapGroup()).getByRole('button', { name: /Groceries/ }), { clientX: 100, clientY: 100 });
    const card = screen.getByTestId('map-card');
    expect(card).toHaveTextContent('🥑 Groceries · Food & Drink');
    expect(card).toHaveTextContent('Spent$300.00');
    expect(card).toHaveTextContent('Share30.0%');
    expect(card).toHaveTextContent('vs previous period+$200.00 (+200%)');
    expect(card).toHaveTextContent('Whole Foods$200.00');
    fireEvent.pointerLeave(mapGroup());
    expect(screen.queryByTestId('map-card')).toBeNull();
  });

  it('clicking a category opens its merchants; the breadcrumb goes back', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(within(mapGroup()).getByRole('button', { name: /Groceries/ }));
    expect(within(mapGroup()).getByText('Whole Foods')).toBeInTheDocument();
    expect(within(mapGroup()).queryByRole('button', { name: /Rent/ })).toBeNull();
    const crumbs = screen.getByRole('navigation', { name: 'Spending map path' });
    expect(crumbs).toHaveTextContent('All spending›Groceries');
    await user.click(within(crumbs).getByRole('button', { name: 'All spending' }));
    expect(within(mapGroup()).getByRole('button', { name: /Rent/ })).toBeInTheDocument();
  });

  it('opens a category from the keyboard too', async () => {
    const user = userEvent.setup();
    draw();
    within(mapGroup()).getByRole('button', { name: /Restaurants/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('navigation', { name: 'Spending map path' })).toHaveTextContent('Restaurants');
  });

  it('tiles glide to their new places when the map changes (not on first draw), but not with Reduce motion', async () => {
    draw();
    expect(within(mapGroup()).getByRole('button', { name: /Rent/ }).style.transition).toBe(''); // first draw: placed at once
    await waitFor(() => expect(within(mapGroup()).getByRole('button', { name: /Rent/ }).style.transition).toContain('300ms'));
    cleanup();
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList);
    draw();
    await new Promise((r) => setTimeout(r, 50));
    expect(within(mapGroup()).getByRole('button', { name: /Rent/ }).style.transition).toBe('');
    spy.mockRestore();
  });
});
