import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BarChart, barPath } from './bar-chart';
import { plotArea } from './frame';

afterEach(() => cleanup());

const labels = ['Jan 2026', "Feb '26", "Mar '26", "Apr '26"];
const values = [250000, -120000, 180000, 90000];
const bars = () => [...document.querySelectorAll('[data-part="bar"]')] as SVGPathElement[];

function chart(over: Partial<Parameters<typeof BarChart>[0]> = {}) {
  return render(<BarChart label="Net income by month" valueLabel="Net income" labels={labels} values={values} color="sign" width={480} height={160} {...over} />);
}

describe('barPath', () => {
  it('rounds the end away from $0: the top of a positive bar, the bottom of a negative one', () => {
    expect(barPath(10, 20, 40, 100, 3)).toBe('M10,100L10,43Q10,40 13,40L27,40Q30,40 30,43L30,100Z');
    expect(barPath(10, 20, 150, 100, 3)).toBe('M10,100L10,147Q10,150 13,150L27,150Q30,150 30,147L30,100Z');
  });
  it('a zero bar is nothing, and the rounding never exceeds the bar', () => {
    expect(barPath(10, 20, 100, 100, 3)).toBe('');
    expect(barPath(10, 4, 99, 100, 3)).toBe('M10,100L10,99Q10,99 10,99L14,99Q14,99 14,99L14,100Z');
  });
});

describe('BarChart', () => {
  it('one narrow bar per month: green above $0, red below', () => {
    chart();
    expect(bars()).toHaveLength(4);
    expect(bars().map((b) => b.style.fill)).toEqual(['var(--pos)', 'var(--neg)', 'var(--pos)', 'var(--pos)']);
    expect(Number(bars()[0].getAttribute('data-width'))).toBeLessThanOrEqual(24);
  });

  it('a hovered month below $0 turns a brighter red', () => {
    chart();
    const svg = screen.getByRole('img', { name: 'Net income by month' });
    const area = plotArea(480, 160);
    fireEvent.pointerMove(svg, { clientX: area.left + (area.width / 4) * 1.5 });
    expect(bars()[1].style.fill).toBe('var(--neg-bright)');
  });

  it('a single color for Income', () => {
    chart({ color: 'var(--income)', values: [400000, 410000, 0, 395000] });
    expect(new Set(bars().map((b) => b.style.fill))).toEqual(new Set(['var(--income)']));
    expect(bars()[2].getAttribute('d')).toBe(''); // nothing for a zero month
  });

  it('hovering a month keeps its bar bright, dims the others and says which month (no tooltip box)', () => {
    const onHover = vi.fn();
    chart({ onHover });
    const svg = screen.getByRole('img', { name: 'Net income by month' });
    const area = plotArea(480, 160);
    fireEvent.pointerMove(svg, { clientX: area.left + (area.width / 4) * 2.5 });
    expect(onHover).toHaveBeenLastCalledWith(2);
    expect(bars().map((b) => b.style.opacity)).toEqual(['0.35', '0.35', '1', '0.35']);
    expect(bars()[2].style.fill).toBe('var(--pos-bright)'); // the hovered bar turns a brighter green, as in Copilot
    expect(bars()[0].style.fill).toBe('var(--pos)');
    expect(document.querySelector('[data-part="band"]')).not.toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerLeave(svg);
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(bars().map((b) => b.style.opacity)).toEqual(['1', '1', '1', '1']);
  });

  it('marks the current month and draws the comparison period', () => {
    chart({ nowIndex: 3, previous: [100000, 50000, null, 80000] });
    expect(within(screen.getByRole('img')).getByText('Now')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-part="previous"]').length).toBe(2);
  });

  it('lists every month’s amount for screen readers', () => {
    chart();
    const rows = within(screen.getByRole('table', { name: 'Net income by month: values' })).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['MonthNet income', 'Jan 2026$2,500.00', "Feb '26-$1,200.00", "Mar '26$1,800.00", "Apr '26$900.00"]);
  });

  it('before it is measured it assumes a sensible width instead of drawing nothing', () => {
    chart({ width: undefined });
    expect(bars()).toHaveLength(4);
  });
});
