// Copilot's month bars (Net income, Income): narrow, rounded at the end away from $0, green/red or one color. Hovering
// a month keeps its bar bright and dims the rest; the card's header says which month (there is no tooltip box).

import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '@/lib/format';
import { displayCurrency } from '@/features/currency/currency-store';
import { prefersReducedMotion } from '../tokens';
import { ChartFrame, plotArea } from './frame';
import { bandLayout, indexAt, valueScale } from './geometry';
import { useChartHover } from './use-chart-hover';

const RADIUS = 3;
const DIM = 0.35;
/** Until the chart is measured (and in tests), assume a typical card width. */
const ASSUMED_WIDTH = 560;

/** A bar from $0 (`yBase`) to its value (`yEnd`), rounded at the value end. Empty for a zero bar. */
export function barPath(x: number, w: number, yEnd: number, yBase: number, radius = RADIUS): string {
  const h = Math.abs(yBase - yEnd);
  if (h === 0 || w <= 0) return '';
  const r = h >= radius * 2 ? Math.min(radius, w / 2) : 0;
  const dir = yEnd < yBase ? 1 : -1; // up for positive bars, down for negative
  const y1 = yEnd + dir * r;
  return `M${x},${yBase}L${x},${y1}Q${x},${yEnd} ${x + r},${yEnd}L${x + w - r},${yEnd}Q${x + w},${yEnd} ${x + w},${y1}L${x + w},${yBase}Z`;
}

/** The width the chart has to draw in, following its container. */
export function useMeasuredWidth(given?: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    if (given != null || !ref.current) return;
    const el = ref.current;
    const read = () => setMeasured(el.getBoundingClientRect().width);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [given]);
  return [ref, given ?? (measured > 0 ? measured : ASSUMED_WIDTH)];
}

/** "$1,200.00" or "-$1,200.00" in the display currency. */
export function signedMoney(cents: number): string {
  return `${cents < 0 ? '-' : ''}${formatMoney(cents, displayCurrency())}`;
}

export function BarChart({
  label,
  valueLabel,
  labels,
  values,
  color,
  previous,
  nowIndex = null,
  height = 150,
  width,
  onHover,
}: {
  label: string;
  /** The column heading for the values in the screen-reader table ("Net income"). */
  valueLabel: string;
  labels: string[];
  values: number[];
  /** "sign": green above $0, red below; otherwise one CSS color. */
  color: 'sign' | string;
  previous?: (number | null)[];
  nowIndex?: number | null;
  height?: number;
  /** Fixed width (tests); otherwise the container's. */
  width?: number;
  onHover?: (index: number | null) => void;
}) {
  const [ref, w] = useMeasuredWidth(width);
  const area = plotArea(w, height);
  const layout = bandLayout(values.length, area.width);
  const scale = valueScale([...values, ...(previous ?? []).filter((v): v is number => v != null)], area.height);
  const hover = useChartHover(values.length, (px) => indexAt(px, layout), { plotLeft: area.left, onHover });
  const transition = prefersReducedMotion() ? undefined : 'opacity 80ms linear';

  return (
    <div ref={ref}>
      <ChartFrame
        label={label}
        width={w}
        height={height}
        area={area}
        layout={layout}
        scale={scale}
        labels={labels}
        hovered={hover.index}
        nowIndex={nowIndex}
        previous={previous}
        bind={hover.bind}
        table={{ columns: ['Month', valueLabel], rows: labels.map((l, i) => [l, signedMoney(values[i] ?? 0)]) }}
      >
        {values.map((v, i) => {
          const slot = layout[i];
          const lit = hover.index === i;
          // The hovered bar turns a brighter green (or red), as in Copilot.
          const fill = color === 'sign' ? (v < 0 ? (lit ? 'var(--neg-bright)' : 'var(--neg)') : lit ? 'var(--pos-bright)' : 'var(--pos)') : color;
          return (
            <path
              key={i}
              data-part="bar"
              data-width={slot.barWidth}
              d={barPath(slot.barX, slot.barWidth, scale.y(v), scale.zero)}
              style={{ fill, opacity: hover.index == null || hover.index === i ? 1 : DIM, transition }}
            />
          );
        })}
      </ChartFrame>
    </div>
  );
}
