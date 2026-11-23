import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plotArea } from './frame';
import { StackedBars, stackSegments, type StackSeries } from './stacked-bars';

afterEach(() => cleanup());

describe('stackSegments', () => {
  const y = (v: number) => 100 - v / 20;
  it('stacks bottom-up in series order with a small gap between segments (none above the top one), skipping zeros', () => {
    expect(stackSegments([1000, 500, 0, 200], y, 2)).toEqual([
      { series: 0, y: 52, height: 48 },
      { series: 1, y: 27, height: 23 },
      { series: 3, y: 15, height: 10 },
    ]);
  });
  it('a sliver still shows as a hairline, and refunds (negative) are left out', () => {
    expect(stackSegments([1000, 20, -300], y, 2)).toEqual([
      { series: 0, y: 52, height: 48 },
      { series: 1, y: 49, height: 1 },
    ]);
    expect(stackSegments([0, 0], y, 2)).toEqual([]);
  });
});

const series: StackSeries[] = [
  { name: 'Rent', color: '#4c85ee', emoji: '🏠', values: [220000, 220000, 220000, 220000] },
  { name: 'Restaurants', color: '#e8743b', emoji: '🍔', values: [39300, 0, 38300, 41000] },
  { name: 'Shopping', color: '#c04ce8', emoji: '🛍️', values: [38200, 43200, 0, 12000] },
  { name: 'Groceries', color: '#e86a3b', emoji: '🥑', values: [29900, 30200, 29100, 0] },
  { name: 'Gas', color: '#ebc769', emoji: '⛽', values: [8000, 7000, 0, 0] },
  { name: 'Coffee', color: '#a0522d', emoji: '☕', values: [3000, 0, 0, 0] },
  { name: 'Gym', color: '#57bd57', emoji: '💪', values: [5500, 0, 0, 0] },
  { name: 'Other', color: '#56677b', emoji: null, values: [12000, 9000, 15000, 0] },
];
const labels = ['Jan 2026', "Feb '26", "Mar '26", "Apr '26"];
const titles = ['Jan 2026', 'Feb 2026', 'Mar 2026', 'Apr 2026'];
const months = () => [...document.querySelectorAll('[data-part="stack"]')] as SVGGElement[];

function chart(onHover = vi.fn()) {
  render(<StackedBars label="Spend by month" labels={labels} titles={titles} series={series} width={480} height={160} onHover={onHover} />);
  return { svg: screen.getByRole('img', { name: 'Spend by month' }), area: plotArea(480, 160), onHover };
}
const hoverMonth = (svg: Element, area: ReturnType<typeof plotArea>, i: number) =>
  fireEvent.pointerMove(svg, { clientX: area.left + (area.width / 4) * (i + 0.5) });

describe('StackedBars', () => {
  it('one stack per month, each category a rounded segment in its color, wider bars than the plain charts', () => {
    chart();
    expect(months()).toHaveLength(4);
    const first = [...months()[0].querySelectorAll('rect')];
    expect(first.map((r) => r.getAttribute('data-color'))).toEqual(series.map((s) => s.color));
    expect(first.every((r) => Number(r.getAttribute('rx')) > 0)).toBe(true);
    expect(Number(first[0].getAttribute('width'))).toBeGreaterThan(18);
  });

  it('hovering a month dims the others, says which month, and opens a dark card listing its categories by amount', () => {
    const { svg, area, onHover } = chart();
    hoverMonth(svg, area, 0);
    expect(onHover).toHaveBeenLastCalledWith(0);
    expect(months().map((g) => g.style.opacity)).toEqual(['1', '0.25', '0.25', '0.25']);
    const card = screen.getByTestId('chart-card');
    expect(within(card).getByText('Jan 2026')).toBeInTheDocument();
    expect(card).toHaveTextContent('$3,559.00'); // the month's total
    const rows = within(card).getAllByRole('listitem').map((li) => li.textContent);
    expect(rows).toEqual([
      '🏠Rent$2,200.00',
      '🍔Restaurants$393.00',
      '🛍️Shopping$382.00',
      '🥑Groceries$299.00',
      'Other$120.00',
      '+3 more$165.00',
    ]);
    fireEvent.pointerLeave(svg);
    expect(screen.queryByTestId('chart-card')).toBeNull();
  });

  it('the card sits beside the bar, and on its left near the right edge', () => {
    const { svg, area } = chart();
    hoverMonth(svg, area, 0);
    const left = parseFloat(screen.getByTestId('chart-card').style.left);
    expect(left).toBeGreaterThan(area.left + area.width / 8);
    hoverMonth(svg, area, 3);
    const card = screen.getByTestId('chart-card');
    expect(parseFloat(card.style.left) + parseFloat(card.style.width)).toBeLessThan(area.left + (area.width / 4) * 3.5);
  });

  it('screen readers get each month’s total', () => {
    chart();
    const rows = within(screen.getByRole('table', { name: 'Spend by month: values' })).getAllByRole('row');
    expect(rows[1].textContent).toBe('Jan 2026$3,559.00');
  });
});
