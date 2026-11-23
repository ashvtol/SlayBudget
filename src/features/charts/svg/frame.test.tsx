import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartFrame, plotArea, xLabelIndexes } from './frame';
import { bandLayout, valueScale } from './geometry';

afterEach(() => cleanup());

const months = ['Jan 2026', "Feb '26", "Mar '26", "Apr '26"];
function frame(over: Partial<Parameters<typeof ChartFrame>[0]> = {}) {
  const area = plotArea(480, 160);
  const layout = bandLayout(4, area.width);
  const scale = valueScale([200000, -100000, 150000, 50000], area.height);
  return render(
    <ChartFrame
      label="Net income by month"
      width={480}
      height={160}
      area={area}
      layout={layout}
      scale={scale}
      labels={months}
      hovered={null}
      table={{ columns: ['Month', 'Net income'], rows: months.map((m) => [m, '$1']) }}
      {...over}
    >
      <rect data-testid="bar" />
    </ChartFrame>,
  );
}

describe('ChartFrame', () => {
  it('draws dotted gridlines with short money labels, the month labels and the chart itself', () => {
    frame();
    const svg = screen.getByRole('img', { name: 'Net income by month' });
    for (const label of ['-$1K', '$0', '$1K', '$2K']) expect(within(svg).getByText(label)).toBeInTheDocument();
    for (const m of months) expect(within(svg).getByText(m)).toBeInTheDocument();
    expect(svg.querySelectorAll('[data-part="grid"]').length).toBe(4);
    expect(within(svg).getByTestId('bar')).toBeInTheDocument();
  });

  it('a soft band behind the hovered month only', () => {
    frame();
    expect(document.querySelector('[data-part="band"]')).toBeNull();
    cleanup();
    frame({ hovered: 2 });
    const band = document.querySelector('[data-part="band"]')!;
    const area = plotArea(480, 160);
    const slot = bandLayout(4, area.width)[2];
    expect(Number(band.getAttribute('x'))).toBeCloseTo(slot.x + 2);
    expect(Number(band.getAttribute('width'))).toBeCloseTo(slot.slotWidth - 4);
  });

  it('a “Now” pill over the current month, and a dashed line for the comparison period (gaps where there is none)', () => {
    frame({ nowIndex: 3, previous: [100000, null, 120000, 90000] });
    const now = within(screen.getByRole('img')).getByText('Now');
    expect(now.closest('[data-part="now"]')).not.toBeNull();
    const lines = document.querySelectorAll('[data-part="previous"]');
    expect(lines.length).toBe(2); // [0] alone is a dot-less segment start; [2]–[3] is a line
    expect(lines[1].getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('has a hidden table of the values for screen readers', () => {
    frame();
    const table = screen.getByRole('table', { name: 'Net income by month: values' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
  });
});

describe('xLabelIndexes', () => {
  it('shows every month when they fit, else only the first and last', () => {
    expect(xLabelIndexes(['Jan 2026', "Feb '26", "Mar '26"], 600)).toEqual([0, 1, 2]);
    expect(xLabelIndexes(Array.from({ length: 12 }, () => "Feb '26"), 300)).toEqual([0, 11]);
    expect(xLabelIndexes(['N', 'D', 'J', 'F'], 100)).toEqual([0, 1, 2, 3]);
    expect(xLabelIndexes([], 100)).toEqual([]);
  });
});
