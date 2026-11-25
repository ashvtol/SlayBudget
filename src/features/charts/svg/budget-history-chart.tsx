// Copilot's category history: 24 capsule bars (green within budget, orange over, blue with no budget, yellow for the
// month in progress), a dash on the baseline for a month with nothing spent, the budget as a thin stepped line that
// fades in from the left with a tag past the last month showing the budget of the month you're looking at, and
// one-letter months. Hover brightens a month and
// dims the rest; clicking picks it (its letter goes bold and the months after it fade).

import { useId, type MouseEvent } from 'react';
import type { BudgetMonth } from '../budget-history';
import { monthInitial } from '../budget-history';
import { prefersReducedMotion } from '../tokens';
import { signedMoney, useMeasuredWidth } from './bar-chart';
import type { PlotArea } from './frame';
import { bandLayout, indexAt, type Slot } from './geometry';
import { useChartHover } from './use-chart-hover';

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DASH = 3;
const DIM_HOVER = 0.35;
const DIM_AFTER_PICK = 0.4;
const TAG_WIDTH = 70;

export function historyColor(m: BudgetMonth, inProgress: boolean): string {
  if (inProgress) return 'var(--current)';
  if (m.budgetCents == null) return 'var(--accent)';
  return m.spentCents > m.budgetCents ? 'var(--warn)' : 'var(--pos)';
}

/** The budget as steps: flat across each budgeted month, joined where it changes, broken where there was none. */
export function budgetSteps(months: BudgetMonth[], layout: Slot[], y: (cents: number) => number): string[] {
  const paths: string[] = [];
  let d = '';
  months.forEach((m, i) => {
    const s = layout[i];
    if (m.budgetCents == null || !s) {
      if (d) paths.push(d);
      d = '';
      return;
    }
    const yy = y(m.budgetCents);
    d += d ? `L${s.x},${yy}L${s.x + s.slotWidth},${yy}` : `M${s.x},${yy}L${s.x + s.slotWidth},${yy}`;
  });
  if (d) paths.push(d);
  // A step with no change is one straight line: drop the redundant middle points.
  return paths.map((p) => p.replace(/L([\d.]+),([\d.]+)L\1,\2/g, 'L$1,$2'));
}

/** Room for the month letters below, and on the right for the budget tag, so it never covers a bar. */
export function historyArea(width: number, height: number): PlotArea {
  return { left: 4, top: 14, width: Math.max(0, width - 8 - TAG_WIDTH - 4), height: Math.max(0, height - 14 - 18) };
}

const monthName = (month: string) => `${FULL_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

export function BudgetHistoryChart({
  months,
  picked,
  height = 120,
  width,
  onPick,
  onHover,
  label = 'Budget history',
}: {
  /** What the chart shows, for screen readers. */
  label?: string;
  months: BudgetMonth[];
  /** A month ("YYYY-MM") picked on the chart. */
  picked?: string;
  height?: number;
  width?: number;
  onPick: (month: string) => void;
  onHover?: (index: number | null) => void;
}) {
  const fadeId = useId();
  const [ref, w] = useMeasuredWidth(width);
  const area = historyArea(w, height);
  const layout = bandLayout(months.length, area.width, { barRatio: 0.42 });
  const max = Math.max(1, ...months.map((m) => Math.max(m.spentCents, m.budgetCents ?? 0))) * 1.15;
  const y = (cents: number) => area.height - (Math.max(0, cents) / max) * area.height;
  const hover = useChartHover(months.length, (px) => indexAt(px, layout), { plotLeft: area.left, onHover });
  const transition = prefersReducedMotion() ? undefined : 'opacity 80ms linear';
  const pickedIndex = picked ? months.findIndex((m) => m.month === picked) : -1;
  const lastBudgeted = months.map((m) => m.budgetCents != null).lastIndexOf(true);
  const tagIndex = hover.index ?? (pickedIndex >= 0 ? pickedIndex : lastBudgeted);
  const tagBudget = tagIndex >= 0 ? months[tagIndex]?.budgetCents ?? null : null;
  const steps = budgetSteps(months, layout, y);
  const opacity = (i: number) =>
    hover.index != null ? (hover.index === i ? 1 : DIM_HOVER) : pickedIndex >= 0 && i > pickedIndex ? DIM_AFTER_PICK : 1;
  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const i = indexAt(e.clientX - e.currentTarget.getBoundingClientRect().left - area.left, layout);
    if (i != null) onPick(months[i].month);
  };

  return (
    <div ref={ref} className="relative">
      <svg
        role="img"
        aria-label={label}
        width={w}
        height={height}
        className="block cursor-pointer overflow-visible outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
        style={{ touchAction: 'none' }}
        onClick={pick}
        {...hover.bind}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hover.index != null) onPick(months[hover.index].month);
          else hover.bind.onKeyDown(e);
        }}
      >
        <defs>
          <linearGradient id={fadeId} gradientUnits="userSpaceOnUse" x1={0} x2={area.width * 0.15} y1={0} y2={0}>
            <stop offset={0} style={{ stopColor: 'var(--text)', stopOpacity: 0 }} />
            <stop offset={1} style={{ stopColor: 'var(--text)', stopOpacity: 0.85 }} />
          </linearGradient>
        </defs>
        <g transform={`translate(${area.left},${area.top})`}>
          {months.map((m, i) => {
            const s = layout[i];
            const empty = m.spentCents <= 0;
            const top = empty ? area.height - DASH : y(m.spentCents);
            const h = empty ? DASH : Math.max(DASH, area.height - top);
            return (
              <rect
                key={m.month}
                data-part="bar"
                data-empty={empty ? 'true' : undefined}
                x={s.barX}
                y={area.height - h}
                width={s.barWidth}
                height={h}
                rx={Math.min(s.barWidth / 2, h / 2)}
                style={{ fill: historyColor(m, i === months.length - 1), opacity: opacity(i), transition }}
              />
            );
          })}
          {steps.map((d, i) => (
            <path key={i} data-part="budget" d={d} fill="none" strokeWidth={1.5} stroke={`url(#${fadeId})`} />
          ))}
          {tagBudget != null && (
            <g data-part="tag" transform={`translate(${area.width + 2},${y(tagBudget)})`}>
              <path d="M0,0 L8,-10 L8,10 Z" style={{ fill: 'var(--text)' }} />
              <rect x={8} y={-10} width={TAG_WIDTH - 8} height={20} rx={3} style={{ fill: 'var(--text)' }} />
              <text x={8 + (TAG_WIDTH - 8) / 2} y={0} dy="0.35em" textAnchor="middle" fontSize={11} fontWeight={700} style={{ fill: 'var(--panel)' }}>
                {signedMoney(tagBudget)}
              </text>
            </g>
          )}
          {months.map((m, i) => {
            const strong = i === (hover.index ?? pickedIndex);
            return (
              <text
                key={m.month}
                x={layout[i].center}
                y={area.height + 14}
                textAnchor="middle"
                fontSize={10}
                fontWeight={strong ? 700 : 600}
                style={{ fill: strong ? 'var(--text)' : 'var(--muted)', opacity: opacity(i) }}
              >
                {monthInitial(m.month)}
              </text>
            );
          })}
        </g>
      </svg>
      <table aria-label={`${label}: values`} className="sr-only">
        <thead>
          <tr>
            <th>Month</th>
            <th>Spent</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.month}>
              <td>{monthName(m.month)}</td>
              <td>{signedMoney(m.spentCents)}</td>
              <td>{m.budgetCents != null ? signedMoney(m.budgetCents) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
