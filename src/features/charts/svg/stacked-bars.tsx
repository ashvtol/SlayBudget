// Copilot's Spend bars: each month stacked by category (the biggest at the bottom), rounded segments with a small gap
// between them. Hovering a month dims the others, the card header follows it, and a dark card beside the bar lists
// that month's categories by amount.

import { prefersReducedMotion } from '../tokens';
import { signedMoney, useMeasuredWidth } from './bar-chart';
import { ChartFrame, plotArea } from './frame';
import { bandLayout, indexAt, valueScale } from './geometry';
import { useChartHover } from './use-chart-hover';

export interface StackSeries {
  name: string;
  color: string;
  emoji: string | null;
  /** One value per month (positive cents). */
  values: number[];
}

export interface Segment {
  series: number;
  y: number;
  height: number;
}

const GAP = 2;
const DIM = 0.25;
const CARD_WIDTH = 220;
const CARD_ROWS = 5;

/** One month's segments bottom-up in series order; a small gap below each segment above the first; zeros and refunds left out. */
export function stackSegments(values: number[], y: (cents: number) => number, gap = GAP): Segment[] {
  const parts = values.map((v, series) => ({ v, series })).filter((p) => p.v > 0);
  let total = 0;
  return parts.map((p, i) => {
    const bottom = y(total);
    total += p.v;
    const top = y(total);
    const full = bottom - top;
    const topmost = i === parts.length - 1;
    // The gap is taken from the top of every segment but the last, so the stack's height stays true.
    const height = topmost ? full : Math.max(1, full - gap);
    return { series: p.series, y: bottom - height, height };
  });
}

export function StackedBars({
  label,
  labels,
  titles,
  series,
  previous,
  nowIndex = null,
  height = 150,
  width,
  onHover,
}: {
  label: string;
  /** Under the bars ("Jan 2026", "Feb '26"). */
  labels: string[];
  /** The card's title per month ("Feb 2026"). */
  titles: string[];
  series: StackSeries[];
  previous?: (number | null)[];
  nowIndex?: number | null;
  height?: number;
  width?: number;
  onHover?: (index: number | null) => void;
}) {
  const [ref, w] = useMeasuredWidth(width);
  const area = plotArea(w, height);
  const count = labels.length;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
  const layout = bandLayout(count, area.width, { barRatio: 0.34 });
  const scale = valueScale([...totals, ...(previous ?? []).filter((v): v is number => v != null)], area.height);
  const hover = useChartHover(count, (px) => indexAt(px, layout), { plotLeft: area.left, onHover });
  const transition = prefersReducedMotion() ? undefined : 'opacity 80ms linear';
  const h = hover.index;

  return (
    <div ref={ref} className="relative">
      <ChartFrame
        label={label}
        width={w}
        height={height}
        area={area}
        layout={layout}
        scale={scale}
        labels={labels}
        hovered={h}
        nowIndex={nowIndex}
        previous={previous}
        bind={hover.bind}
        table={{ columns: ['Month', 'Spend'], rows: titles.map((t, i) => [t, signedMoney(totals[i])]) }}
      >
        {labels.map((_, i) => {
          const slot = layout[i];
          const segments = stackSegments(series.map((s) => s.values[i] ?? 0), scale.y);
          return (
            <g key={i} data-part="stack" style={{ opacity: h == null || h === i ? 1 : DIM, transition }}>
              {segments.map((seg) => (
                <rect
                  key={seg.series}
                  data-color={series[seg.series].color}
                  x={slot.barX}
                  y={seg.y}
                  width={slot.barWidth}
                  height={seg.height}
                  rx={Math.min(2, seg.height / 2)}
                  style={{ fill: series[seg.series].color }}
                />
              ))}
            </g>
          );
        })}
      </ChartFrame>
      {h != null && layout[h] && <MonthCard title={titles[h]} total={totals[h]} series={series} index={h} left={cardLeft(area.left, layout[h], w)} top={area.top} />}
    </div>
  );
}

/** Beside the bar, or on its left when the card would run past the chart's right edge. */
function cardLeft(plotLeft: number, slot: { center: number; barWidth: number }, width: number): number {
  const right = plotLeft + slot.center + slot.barWidth / 2 + 10;
  return right + CARD_WIDTH <= width ? right : plotLeft + slot.center - slot.barWidth / 2 - 10 - CARD_WIDTH;
}

function MonthCard({ title, total, series, index, left, top }: { title: string; total: number; series: StackSeries[]; index: number; left: number; top: number }) {
  const rows = series
    .map((s) => ({ s, cents: Math.max(0, s.values[index] ?? 0) }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const shown = rows.slice(0, CARD_ROWS);
  const rest = rows.slice(CARD_ROWS);
  return (
    <div
      data-testid="chart-card"
      role="group"
      aria-label={`${title}: spending by category`}
      className="pointer-events-none absolute z-20 rounded-lg border px-3 py-2.5 text-[12px] shadow-2xl"
      style={{ left, top, width: CARD_WIDTH, background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-2 flex items-center justify-between font-semibold">
        <span>{title}</span>
        <span className="tabular-nums">{signedMoney(total)}</span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {shown.map(({ s, cents }) => (
          <li key={s.name} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            {s.emoji && <span>{s.emoji}</span>}
            <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--muted)' }}>{s.name}</span>
            <span className="tabular-nums">{signedMoney(cents)}</span>
          </li>
        ))}
        {rest.length > 0 && (
          <li className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <span className="h-2 w-2 shrink-0" />
            <span className="min-w-0 flex-1">+{rest.length} more</span>
            <span className="tabular-nums">{signedMoney(rest.reduce((sum, r) => sum + r.cents, 0))}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
