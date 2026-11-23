// The parts every bar chart shares, drawn the way Copilot does: dotted gridlines with short money labels on the left,
// month labels below, a soft band behind the hovered month, a "Now" pill over the current one, and a dashed line for
// the comparison period. The chart's own marks go in as children, already in plot coordinates.

import type { ReactNode, SVGProps } from 'react';
import type { Slot, ValueScale } from './geometry';

export interface PlotArea {
  left: number;
  top: number;
  width: number;
  height: number;
}

const MARGIN = { left: 44, right: 8, top: 22, bottom: 22 };

/** Where the bars go inside a chart of this size (room for money labels on the left, months below, "Now" above). */
export function plotArea(width: number, height: number): PlotArea {
  return {
    left: MARGIN.left,
    top: MARGIN.top,
    width: Math.max(0, width - MARGIN.left - MARGIN.right),
    height: Math.max(0, height - MARGIN.top - MARGIN.bottom),
  };
}

const CHAR_PX = 6.5;
const LABEL_GAP = 12;

/** Every month's label when they fit side by side; otherwise only the first and the last (as Copilot does). */
export function xLabelIndexes(labels: string[], plotWidth: number): number[] {
  const all = labels.map((_, i) => i);
  if (labels.length <= 2) return all;
  const needed = labels.reduce((sum, l) => sum + l.length * CHAR_PX + LABEL_GAP, 0);
  return needed <= plotWidth ? all : [0, labels.length - 1];
}

export interface ChartTable {
  columns: string[];
  rows: string[][];
}

export function ChartFrame({
  label,
  width,
  height,
  area,
  layout,
  scale,
  labels,
  hovered,
  nowIndex = null,
  previous,
  table,
  bind,
  children,
}: {
  /** The chart's accessible name. */
  label: string;
  width: number;
  height: number;
  area: PlotArea;
  layout: Slot[];
  scale: ValueScale;
  /** One label per slot ("Jan 2026", "Feb '26" or "N", "D", ...). */
  labels: string[];
  hovered: number | null;
  nowIndex?: number | null;
  /** The comparison period, per slot (null where there is none). */
  previous?: (number | null)[];
  /** The values as a table, for screen readers. */
  table: ChartTable;
  /** Hover handlers from useChartHover. */
  bind?: Partial<SVGProps<SVGSVGElement>>;
  children: ReactNode;
}) {
  const shown = new Set(xLabelIndexes(labels, area.width));
  const thinned = shown.size < labels.length;
  const runs: { x: number; y: number }[][] = [];
  previous?.forEach((v, i) => {
    if (v == null || !layout[i]) {
      runs.push([]);
      return;
    }
    if (runs.length === 0) runs.push([]);
    runs[runs.length - 1].push({ x: layout[i].center, y: scale.y(v) });
  });
  const lines = runs.filter((r) => r.length > 0);

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={height}
        className="block overflow-visible outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
        style={{ touchAction: 'none' }}
        {...bind}
      >
        <g transform={`translate(${area.left},${area.top})`}>
          {scale.ticks.map((t) => (
            <g key={t.value}>
              <line
                data-part="grid"
                x1={0}
                x2={area.width}
                y1={t.y}
                y2={t.y}
                strokeDasharray="1 4"
                style={{ stroke: 'var(--subtle)', strokeOpacity: 0.5 }}
              />
              <text x={-8} y={t.y} dy="0.32em" textAnchor="end" fontSize={11} style={{ fill: 'var(--muted)' }}>
                {t.label}
              </text>
            </g>
          ))}
          {hovered != null && layout[hovered] && (
            <rect
              data-part="band"
              x={layout[hovered].x + 2}
              y={0}
              width={Math.max(0, layout[hovered].slotWidth - 4)}
              height={area.height}
              rx={4}
              style={{ fill: 'var(--accent)', fillOpacity: 0.09 }}
            />
          )}
          {lines.map((run, i) => (
            <path
              key={i}
              data-part="previous"
              d={run.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('')}
              fill="none"
              strokeWidth={1}
              strokeDasharray="3 4"
              style={{ stroke: 'var(--subtle)' }}
            />
          ))}
          {children}
          {nowIndex != null && layout[nowIndex] && (
            <g data-part="now" transform={`translate(${layout[nowIndex].center},-14)`}>
              <rect x={-15} y={-8} width={30} height={16} rx={4} style={{ fill: 'var(--panel)', stroke: 'var(--subtle)' }} />
              <text textAnchor="middle" dy="0.35em" fontSize={10} fontWeight={500} style={{ fill: 'var(--text)' }}>
                Now
              </text>
            </g>
          )}
          {labels.map((l, i) =>
            shown.has(i) && layout[i] ? (
              <text
                key={i}
                x={thinned ? (i === 0 ? layout[i].barX : layout[i].barX + layout[i].barWidth) : layout[i].center}
                y={area.height + 15}
                textAnchor={thinned ? (i === 0 ? 'start' : 'end') : 'middle'}
                fontSize={11}
                style={{ fill: hovered === i ? 'var(--text)' : 'var(--muted)' }}
              >
                {l}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      <table aria-label={`${label}: values`} className="sr-only">
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
