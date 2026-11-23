import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaceLine, paceArea, paceColors, pacePill, paceStatus } from './pace-line';

afterEach(() => cleanup());

// A 30-day month with a $3,000 budget: the even pace is $100 a day.
const BUDGET = 300000;
const under = [5000, 12000, 20000, 30000, 38000]; // always below $100/day
const crossing = [5000, 12000, 20000, 43000, 52000]; // day 4 is 7.5% ahead, day 5 4% ahead
const far = [5000, 12000, 20000, 60000, 80000]; // day 4 is 50% ahead

describe('paceStatus', () => {
  it('compares spend with the even pace and the budget', () => {
    expect(paceStatus(250, 250, 1000)).toBe('under');
    expect(paceStatus(300, 250, 1000)).toBe('ahead');
    expect(paceStatus(301, 250, 1000)).toBe('farAhead');
    expect(paceStatus(1001, 1000, 1000)).toBe('over');
    expect(paceStatus(10, 0, 0)).toBe('none');
  });
});

describe('paceColors: each day colored by how it stands against the even pace (as Copilot does)', () => {
  it('green under pace, yellow a little ahead, orange far ahead, red over the budget', () => {
    expect(paceColors(under, 30, BUDGET)).toEqual(Array(5).fill('var(--pos)'));
    expect(paceColors(crossing, 30, BUDGET)).toEqual(['var(--pos)', 'var(--pos)', 'var(--pos)', 'var(--current)', 'var(--current)']);
    expect(paceColors(far, 30, BUDGET).slice(3)).toEqual(['var(--warn)', 'var(--warn)']);
    expect(paceColors([100000, 320000], 30, BUDGET)[1]).toBe('var(--neg)');
  });
  it('without a budget, one neutral color', () => {
    expect(paceColors(under, 30, 0)).toEqual(Array(5).fill('var(--accent)'));
  });
});

describe('pacePill: how far today is from the pace', () => {
  it('ahead of pace reads "over", below reads "under", in whole dollars', () => {
    expect(pacePill(crossing, 30, BUDGET)).toEqual({ text: '$20 over', color: 'var(--current)' });
    expect(pacePill(under, 30, BUDGET)).toEqual({ text: '$120 under', color: 'var(--pos)' });
  });
  it('none without a budget or before any spending', () => {
    expect(pacePill(under, 30, 0)).toBeNull();
    expect(pacePill([], 30, BUDGET)).toBeNull();
  });
});

describe('PaceLine', () => {
  const draw = (daily: number[], budget = BUDGET, onHover = vi.fn()) =>
    render(<PaceLine daily={daily} daysInMonth={30} budgetCents={budget} month="2026-11" width={480} height={160} onHover={onHover} />);
  const svg = () => screen.getByRole('img', { name: 'Spending this month against budget' });
  const area = () => paceArea(480, 160);
  const hoverDay = (day: number) => fireEvent.pointerMove(svg(), { clientX: area().left + (area().width * day) / 29 });

  it('a line colored day by day, a dotted pace line to month end, a ring at today and a pill', () => {
    draw(crossing);
    const line = svg().querySelector('[data-part="spent"]')!;
    expect(line.getAttribute('stroke')).toMatch(/^url\(#/);
    const stops = [...svg().querySelectorAll('linearGradient stop')].map((s) => (s as SVGStopElement).style.stopColor);
    expect(stops).toEqual(['var(--pos)', 'var(--pos)', 'var(--pos)', 'var(--current)', 'var(--current)']);
    expect(svg().querySelector('[data-part="pace"]')!.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(svg().querySelector('[data-part="ring"]')).not.toBeNull();
    expect(screen.getByText('$20 over')).toBeInTheDocument();
  });

  it('has axes: money on the left with dotted gridlines, days of the month along the bottom', () => {
    draw(crossing);
    for (const label of ['$0', '$1K', '$2K', '$3K']) expect(within(svg()).getByText(label)).toBeInTheDocument();
    expect(svg().querySelectorAll('[data-part="grid"]').length).toBe(4);
    for (const label of ['Nov 1', 'Nov 8', 'Nov 15', 'Nov 22', 'Nov 30']) expect(within(svg()).getByText(label)).toBeInTheDocument();
  });

  it('hovering a past day: a guide line, the ring on the line, and a card with what was spent and what the budget allowed by then', () => {
    const onHover = vi.fn();
    draw(crossing, BUDGET, onHover);
    hoverDay(1);
    expect(onHover).toHaveBeenLastCalledWith(1);
    expect(svg().querySelector('[data-part="guide"]')).not.toBeNull();
    const card = screen.getByTestId('pace-card');
    expect(card).toHaveTextContent('Nov 2');
    expect(card).toHaveTextContent('Spent$120.00');
    expect(card).toHaveTextContent('Budget$200.00');
    expect(screen.queryByText('$20 over')).toBeNull(); // the pill steps aside while you look around
  });

  it('hovering a day still to come shows only the budget for that day, with the ring on the pace line', () => {
    draw(crossing);
    hoverDay(26);
    const card = screen.getByTestId('pace-card');
    expect(card).toHaveTextContent('Nov 27');
    expect(card).toHaveTextContent('Budget$2,700.00');
    expect(card).not.toHaveTextContent('Spent');
    fireEvent.pointerLeave(svg());
    expect(screen.queryByTestId('pace-card')).toBeNull();
    expect(screen.getByText('$20 over')).toBeInTheDocument();
  });

  it('without a budget: one neutral line, no pace line, no pill; hovering shows what was spent', () => {
    draw(under, 0);
    expect(svg().querySelector('[data-part="pace"]')).toBeNull();
    expect(screen.queryByText(/over$|under$/)).toBeNull();
    hoverDay(2);
    expect(screen.getByTestId('pace-card')).toHaveTextContent('Spent$200.00');
    expect(screen.getByTestId('pace-card')).not.toHaveTextContent('Budget');
  });

  it('screen readers get each day’s total and budget', () => {
    draw(under);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(rows[1].textContent).toBe('Nov 1$50.00$100.00');
  });
});
