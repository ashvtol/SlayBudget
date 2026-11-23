// Copilot's "Monthly spending": spending so far this month as one line, colored day by day by how it stands against the
// even pace (green under, yellow a little ahead, orange far ahead, red over budget), a dotted pace line to the end of
// the month, a ring at today and a pill saying how far today is from the pace. Money and day axes (asked for, unlike
// Copilot); hovering any day shows a guide line and a card with what was spent and what the budget allowed by then.

import { useId } from 'react';
import { localeFor } from '@/lib/format';
import { displayCurrency } from '@/features/currency/currency-store';
import { signedMoney, useMeasuredWidth } from './bar-chart';
import type { PlotArea } from './frame';
import { valueScale } from './geometry';
import { useChartHover } from './use-chart-hover';

export type PaceStatus = 'none' | 'under' | 'ahead' | 'farAhead' | 'over';

/** Copilot's pace: under the even pace, ahead by up to 20%, further ahead, or over the budget. */
export function paceStatus(spentCents: number, paceCents: number, budgetCents: number): PaceStatus {
  if (budgetCents <= 0) return 'none';
  if (spentCents > budgetCents) return 'over';
  if (spentCents <= paceCents) return 'under';
  return spentCents <= paceCents * 1.2 ? 'ahead' : 'farAhead';
}

/** Room above and to the right of the line for the ring. */
export const PACE_PAD = 12;

const STATUS_COLOR = { none: 'var(--accent)', under: 'var(--pos)', ahead: 'var(--current)', farAhead: 'var(--warn)', over: 'var(--neg)' } as const;

const evenPace = (day: number, daysInMonth: number, budgetCents: number) => Math.round((budgetCents * (day + 1)) / daysInMonth);

/** One color per day so far. */
export function paceColors(daily: number[], daysInMonth: number, budgetCents: number): string[] {
  return daily.map((spent, i) => STATUS_COLOR[paceStatus(spent, evenPace(i, daysInMonth, budgetCents), budgetCents)]);
}

const wholeMoney = (cents: number) =>
  new Intl.NumberFormat(localeFor(displayCurrency()), { style: 'currency', currency: displayCurrency(), minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.abs(cents) / 100);

/** "$37 over" (ahead of the even pace) or "$120 under", in the color of today's standing. */
export function pacePill(daily: number[], daysInMonth: number, budgetCents: number): { text: string; color: string } | null {
  if (budgetCents <= 0 || daily.length === 0) return null;
  const today = daily.length - 1;
  const diff = daily[today] - evenPace(today, daysInMonth, budgetCents);
  return { text: `${wholeMoney(diff)} ${diff > 0 ? 'over' : 'under'}`, color: paceColors(daily, daysInMonth, budgetCents)[today] };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CARD_WIDTH = 150;

/** Where the line goes: room for money labels on the left and day labels below. */
export function paceArea(width: number, height: number): PlotArea {
  return { left: 44, top: PACE_PAD, width: Math.max(0, width - 44 - PACE_PAD), height: Math.max(0, height - PACE_PAD - 24) };
}

export function PaceLine({
  daily,
  daysInMonth,
  budgetCents,
  month,
  height = 160,
  width,
  onHover,
}: {
  /** Cumulative spending through each day so far (cents). */
  daily: number[];
  daysInMonth: number;
  budgetCents: number;
  /** "YYYY-MM", for the day labels. */
  month: string;
  height?: number;
  width?: number;
  /** The hovered day (0 = the 1st), or null. */
  onHover?: (day: number | null) => void;
}) {
  const gradientId = useId();
  const [ref, w] = useMeasuredWidth(width);
  const area = paceArea(w, height);
  const scale = valueScale([...daily, budgetCents], area.height);
  const x = (day: number) => (daysInMonth > 1 ? (day / (daysInMonth - 1)) * area.width : 0);
  const last = daily.length - 1;
  const hover = useChartHover(
    daysInMonth,
    (px) => (px < 0 || px > area.width ? null : Math.round((px / area.width) * (daysInMonth - 1))),
    { plotLeft: area.left, onHover },
  );
  const colors = paceColors(daily, daysInMonth, budgetCents);
  const pill = pacePill(daily, daysInMonth, budgetCents);
  const monthName = MONTHS[Number(month.slice(5, 7)) - 1];
  const dayLabel = (day: number) => `${monthName} ${day + 1}`;
  const h = hover.index;
  const spentAt = (day: number) => (day <= last ? daily[day] : null);
  const budgetAt = (day: number) => (budgetCents > 0 ? evenPace(day, daysInMonth, budgetCents) : null);
  // The ring: today, or the hovered day (on the spending line, or on the pace line for days still to come).
  const ringDay = h ?? last;
  const ringValue = ringDay < 0 ? null : spentAt(ringDay) ?? budgetAt(ringDay);
  const ringColor = ringDay >= 0 && ringDay <= last ? colors[ringDay] : 'var(--subtle)';
  const path = daily.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${scale.y(v)}`).join('');
  const ticksX = [0, 7, 14, 21, daysInMonth - 1].filter((d, i, all) => d < daysInMonth && all.indexOf(d) === i);

  return (
    <div ref={ref} className="relative">
      <svg
        role="img"
        aria-label="Spending this month against budget"
        width={w}
        height={height}
        className="block overflow-visible outline-none focus-visible:[outline:2px_solid_var(--accent)] focus-visible:[outline-offset:2px]"
        style={{ touchAction: 'none' }}
        {...hover.bind}
      >
        <defs>
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={x(0)} x2={x(Math.max(1, last))} y1={0} y2={0}>
            {colors.map((c, i) => (
              <stop key={i} offset={last > 0 ? i / last : 0} style={{ stopColor: c }} />
            ))}
          </linearGradient>
        </defs>
        <g transform={`translate(${area.left},${area.top})`}>
          {scale.ticks.map((t) => (
            <g key={t.value}>
              <line data-part="grid" x1={0} x2={area.width} y1={t.y} y2={t.y} strokeDasharray="1 4" style={{ stroke: 'var(--subtle)', strokeOpacity: 0.5 }} />
              <text x={-8} y={t.y} dy="0.32em" textAnchor="end" fontSize={11} style={{ fill: 'var(--muted)' }}>
                {t.label}
              </text>
            </g>
          ))}
          {ticksX.map((d) => (
            <text
              key={d}
              x={x(d)}
              y={area.height + 16}
              textAnchor={d === 0 ? 'start' : d === daysInMonth - 1 ? 'end' : 'middle'}
              fontSize={11}
              style={{ fill: h === d ? 'var(--text)' : 'var(--muted)' }}
            >
              {dayLabel(d)}
            </text>
          ))}
          {h != null && <line data-part="guide" x1={x(h)} x2={x(h)} y1={0} y2={area.height} style={{ stroke: 'var(--subtle)' }} />}
          {budgetCents > 0 && (
            <path
              data-part="pace"
              d={`M${x(0)},${scale.y(0)}L${x(daysInMonth - 1)},${scale.y(budgetCents)}`}
              fill="none"
              strokeWidth={1}
              strokeDasharray="3 5"
              style={{ stroke: 'var(--subtle)' }}
            />
          )}
          {daily.length > 0 && (
            <path data-part="spent" d={path} fill="none" stroke={`url(#${gradientId})`} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {ringValue != null && (
            <circle data-part="ring" cx={x(ringDay)} cy={scale.y(ringValue)} r={5} strokeWidth={2.5} style={{ fill: 'var(--panel)', stroke: ringColor }} />
          )}
          {pill && h == null && (
            <g data-part="pill" transform={`translate(${Math.min(x(last), area.width - 70)},${scale.y(daily[last]) + 12})`}>
              <path d="M0,0 L6,6 L0,6 Z" style={{ fill: pill.color }} />
              <rect x={0} y={6} width={pill.text.length * 7 + 14} height={20} rx={4} style={{ fill: pill.color }} />
              <text x={7} y={20} fontSize={12} fontWeight={700} style={{ fill: 'var(--bg)' }}>
                {pill.text}
              </text>
            </g>
          )}
        </g>
      </svg>
      {h != null && (
        <div
          data-testid="pace-card"
          role="group"
          aria-label={`${dayLabel(h)}: spending and budget`}
          className="pointer-events-none absolute z-20 rounded-lg border px-3 py-2 text-[12px] shadow-2xl"
          style={{
            left: area.left + x(h) + 12 + CARD_WIDTH <= w ? area.left + x(h) + 12 : area.left + x(h) - 12 - CARD_WIDTH,
            top: area.top,
            width: CARD_WIDTH,
            background: 'var(--panel)',
            borderColor: 'var(--line-strong)',
          }}
        >
          <div className="mb-1 font-semibold">{dayLabel(h)}</div>
          {spentAt(h) != null && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Spent</span>
              <span className="tabular-nums">{signedMoney(spentAt(h)!)}</span>
            </div>
          )}
          {budgetAt(h) != null && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Budget</span>
              <span className="tabular-nums">{signedMoney(budgetAt(h)!)}</span>
            </div>
          )}
        </div>
      )}
      <table aria-label="Spending this month: values" className="sr-only">
        <thead>
          <tr>
            <th>Day</th>
            <th>Spent so far</th>
            <th>Budget by then</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((v, i) => (
            <tr key={i}>
              <td>{dayLabel(i)}</td>
              <td>{signedMoney(v)}</td>
              <td>{budgetAt(i) != null ? signedMoney(budgetAt(i)!) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
