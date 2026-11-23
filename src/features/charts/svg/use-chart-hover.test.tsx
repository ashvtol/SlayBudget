import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bandLayout, indexAt } from './geometry';
import { useChartHover } from './use-chart-hover';

afterEach(() => cleanup());

function Probe({ onHover }: { onHover?: (i: number | null) => void }) {
  const layout = bandLayout(4, 400);
  const { index, bind } = useChartHover(layout.length, (px) => indexAt(px, layout), { plotLeft: 40, onHover });
  return (
    <svg data-testid="chart" aria-label="Probe" {...bind}>
      <text>{index == null ? 'none' : `month ${index}`}</text>
    </svg>
  );
}

describe('useChartHover', () => {
  it('follows the pointer straight away (no easing), counting from the plot’s left edge', () => {
    const onHover = vi.fn();
    render(<Probe onHover={onHover} />);
    const chart = screen.getByTestId('chart');
    fireEvent.pointerMove(chart, { clientX: 40 + 150 });
    expect(screen.getByText('month 1')).toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 40 + 399 });
    expect(screen.getByText('month 3')).toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 10 }); // over the y labels: nothing
    expect(screen.getByText('none')).toBeInTheDocument();
    fireEvent.pointerMove(chart, { clientX: 40 + 50 });
    fireEvent.pointerLeave(chart);
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(onHover.mock.calls.map((c) => c[0])).toEqual([1, 3, null, 0, null]);
  });

  it('moves with ← → when the chart has focus; Escape and leaving focus clear it', async () => {
    const user = userEvent.setup();
    render(<Probe />);
    const chart = screen.getByTestId('chart');
    chart.focus();
    expect(chart).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('month 0')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByText('month 3')).toBeInTheDocument(); // stops at the last month
    await user.keyboard('{Escape}');
    expect(screen.getByText('none')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('month 3')).toBeInTheDocument(); // ← from nothing starts at the latest month
    act(() => chart.blur());
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});
