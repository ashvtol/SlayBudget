import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BudgetMonth } from '../budget-history';
import { BudgetHistoryChart, budgetSteps, historyArea, historyColor } from './budget-history-chart';
import { bandLayout } from './geometry';

afterEach(() => cleanup());

// Six months, the last one in progress: no budget, then $400 a month, then $700.
const months: BudgetMonth[] = [
  { month: '2026-06', spentCents: 12000, budgetCents: null },
  { month: '2026-07', spentCents: 0, budgetCents: 40000 },
  { month: '2026-08', spentCents: 35000, budgetCents: 40000 },
  { month: '2026-09', spentCents: 46000, budgetCents: 40000 },
  { month: '2026-10', spentCents: 62000, budgetCents: 70000 },
  { month: '2026-11', spentCents: 30000, budgetCents: 70000 },
];
const W = 480;
const H = 120;

describe('historyColor', () => {
  it('blue with no budget, green within, orange over, yellow for the month in progress', () => {
    expect(months.map((m, i) => historyColor(m, i === months.length - 1))).toEqual([
      'var(--accent)', 'var(--pos)', 'var(--pos)', 'var(--warn)', 'var(--pos)', 'var(--current)',
    ]);
  });
});

describe('budgetSteps', () => {
  it('a flat step across each budgeted month, joined where the budget changes, with a gap where there was none', () => {
    const layout = bandLayout(3, 300);
    const y = (v: number) => 100 - v / 1000;
    expect(budgetSteps([{ month: 'a', spentCents: 0, budgetCents: 40000 }, { month: 'b', spentCents: 0, budgetCents: 70000 }, { month: 'c', spentCents: 0, budgetCents: null }], layout, y)).toEqual([
      'M0,60L100,60L100,30L200,30',
    ]);
    expect(budgetSteps([{ month: 'a', spentCents: 0, budgetCents: 40000 }, { month: 'b', spentCents: 0, budgetCents: null }, { month: 'c', spentCents: 0, budgetCents: 40000 }], layout, y)).toEqual([
      'M0,60L100,60',
      'M200,60L300,60',
    ]);
  });
});

describe('BudgetHistoryChart', () => {
  const draw = (over: Partial<Parameters<typeof BudgetHistoryChart>[0]> = {}) =>
    render(<BudgetHistoryChart months={months} width={W} height={H} onPick={vi.fn()} {...over} />);
  const svg = () => screen.getByRole('img', { name: 'Budget history' });
  const bars = () => [...svg().querySelectorAll('[data-part="bar"]')] as SVGRectElement[];
  const at = (i: number) => {
    const area = historyArea(W, H);
    return area.left + (area.width / months.length) * (i + 0.5);
  };

  it('capsule bars (fully rounded) in their colors, a dash on the baseline for a month with nothing spent, one-letter months', () => {
    draw();
    expect(bars().map((b) => b.style.fill)).toEqual(['var(--accent)', 'var(--pos)', 'var(--pos)', 'var(--warn)', 'var(--pos)', 'var(--current)']);
    const w = Number(bars()[2].getAttribute('width'));
    expect(Number(bars()[2].getAttribute('rx'))).toBe(w / 2);
    expect(bars()[1].getAttribute('data-empty')).toBe('true');
    expect(Number(bars()[1].getAttribute('height'))).toBe(3);
    for (const l of ['J', 'A', 'S', 'O', 'N']) expect(within(svg()).getAllByText(l).length).toBeGreaterThan(0);
    expect(svg().querySelectorAll('[data-part="grid"]')).toHaveLength(0);
  });

  it('the budget is a stepped line fading in from the left, tagged with the latest budget', () => {
    draw();
    expect(svg().querySelectorAll('[data-part="budget"]')).toHaveLength(1);
    expect(svg().querySelector('[data-part="budget"]')!.getAttribute('stroke')).toMatch(/^url\(#/);
    expect(within(svg()).getByText('$700.00')).toBeInTheDocument();
  });

  it('hovering a month brightens it, dims the rest and says which month', () => {
    const onHover = vi.fn();
    draw({ onHover });
    fireEvent.pointerMove(svg(), { clientX: at(3) });
    expect(onHover).toHaveBeenLastCalledWith(3);
    expect(bars().map((b) => b.style.opacity)).toEqual(['0.35', '0.35', '0.35', '1', '0.35', '0.35']);
    expect(within(svg()).getByText('$400.00')).toBeInTheDocument(); // the tag shows that month's budget
  });

  it('clicking a month picks it: its letter goes bold, the months after it fade, the tag moves to it', () => {
    const onPick = vi.fn();
    const { rerender } = draw({ onPick });
    fireEvent.click(svg(), { clientX: at(2) });
    expect(onPick).toHaveBeenCalledWith('2026-08');
    rerender(<BudgetHistoryChart months={months} width={W} height={H} onPick={onPick} picked="2026-08" />);
    expect(bars().map((b) => b.style.opacity)).toEqual(['1', '1', '1', '0.4', '0.4', '0.4']);
    expect(within(svg()).getByText('$400.00')).toBeInTheDocument();
  });

  it('screen readers get each month’s spending and budget', () => {
    draw();
    const rows = within(screen.getByRole('table', { name: 'Budget history: values' })).getAllByRole('row');
    expect(rows[4].textContent).toBe('September 2026$460.00$400.00');
  });
});
