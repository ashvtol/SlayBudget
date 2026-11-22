// Copilot-style period charts (Cash flow, Dashboard). Pure option builders.

import type { EChartsOption } from 'echarts';
import type { ChartTokens } from './tokens';

export interface PeriodPoint {
  label: string;
  valueCents: number;
}

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);

/** The small "Now" tag drawn above the current period's bar. */
export function nowTag(tokens: ChartTokens) {
  return {
    show: true,
    formatter: 'Now',
    position: 'top' as const,
    distance: 6,
    color: tokens.text,
    fontSize: 11,
    fontWeight: 500,
    backgroundColor: tokens.panel,
    borderColor: tokens.subtle,
    borderWidth: 1,
    borderRadius: 3,
    padding: [3, 5],
  };
}

export function axes(labels: string[], tokens: ChartTokens) {
  return {
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tokens.muted, fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      splitNumber: 2,
      axisLabel: { color: tokens.muted, fontSize: 11, formatter: (v: number) => money(v) },
      splitLine: { lineStyle: { color: tokens.grid } },
    },
  };
}

/** Dashed line for the same periods a year (or period) earlier. */
export function previousLine(previous: (number | null)[], tokens: ChartTokens) {
  return {
    name: 'Previous period',
    type: 'line' as const,
    data: previous,
    symbol: 'none',
    z: 1,
    lineStyle: { type: 'dashed' as const, width: 1, color: tokens.subtle },
  };
}

/**
 * One bar per period. Periods after `nowIndex` stay empty (the axis still shows
 * them); the current period carries a "Now" tag. `color: 'sign'` paints gains
 * green and losses red.
 */
export function periodBars(
  points: PeriodPoint[],
  tokens: ChartTokens,
  opts: { nowIndex: number; color: 'sign' | string; previous?: (number | null)[]; reduceMotion?: boolean },
): EChartsOption {
  const data = points.map((p, i) => {
    if (i > opts.nowIndex) return { value: null };
    const color = opts.color === 'sign' ? (p.valueCents < 0 ? tokens.neg : tokens.pos) : opts.color;
    return {
      value: p.valueCents,
      itemStyle: { color, borderRadius: 2 },
      ...(i === opts.nowIndex ? { label: nowTag(tokens) } : {}),
    };
  });
  const series: EChartsOption['series'] = [{ name: 'Value', type: 'bar', data, barWidth: 12, z: 2 }];
  if (opts.previous) series.push(previousLine(opts.previous, tokens));
  return {
    animation: !opts.reduceMotion,
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '' : money(Number(v))) },
    ...axes(points.map((p) => p.label), tokens),
    series,
  };
}

export interface CategorySeries {
  name: string;
  color: string;
  values: number[];
}

/**
 * Spend per period stacked by category, in category colors. The "Now" tag sits
 * on the top segment of the current period; later periods stay empty.
 */
export function stackedCategoryBars(
  labels: string[],
  categories: CategorySeries[],
  tokens: ChartTokens,
  opts: { nowIndex: number; previous?: (number | null)[]; reduceMotion?: boolean },
): EChartsOption {
  const last = categories.length - 1;
  const series: EChartsOption['series'] = categories.map((c, ci) => ({
    name: c.name,
    type: 'bar' as const,
    stack: 'spend',
    barWidth: 12,
    z: 2,
    itemStyle: { color: c.color, borderColor: tokens.panel, borderWidth: 1 },
    data: labels.map((_, i) => {
      if (i > opts.nowIndex) return { value: null };
      return { value: c.values[i] ?? 0, ...(ci === last && i === opts.nowIndex ? { label: nowTag(tokens) } : {}) };
    }),
  }));
  if (opts.previous) series.push(previousLine(opts.previous, tokens));
  return {
    animation: !opts.reduceMotion,
    grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '' : money(Number(v))) },
    ...axes(labels, tokens),
    series,
  };
}

export type PaceStatus = 'none' | 'under' | 'ahead' | 'farAhead' | 'over';

/** Copilot's pace: under the even pace, ahead by up to 20%, further ahead, or over the budget. */
export function paceStatus(spentCents: number, paceCents: number, budgetCents: number): PaceStatus {
  if (budgetCents <= 0) return 'none';
  if (spentCents > budgetCents) return 'over';
  if (spentCents <= paceCents) return 'under';
  return spentCents <= paceCents * 1.2 ? 'ahead' : 'farAhead';
}

/** The warning orange, lightened: "a little ahead of pace". */
export function lightOrange(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.4);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Dashboard "Monthly spending": cumulative spend through today, and a dashed
 * even pace from zero to the full budget at month end. The spend line is green
 * under the pace, light orange up to 20% ahead, dark orange beyond, red over budget.
 */
export function spendingPace(daily: number[], daysInMonth: number, budgetCents: number, tokens: ChartTokens, opts: { reduceMotion?: boolean } = {}): EChartsOption {
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
  const spent = days.map((_, i) => (i < daily.length ? daily[i] : null));
  const pace = days.map((_, i) => Math.round((budgetCents * (i + 1)) / daysInMonth));
  const today = daily.length - 1;
  const status = today >= 0 ? paceStatus(daily[today], pace[today], budgetCents) : 'none';
  const color = { none: tokens.accent, under: tokens.pos, ahead: lightOrange(tokens.warn), farAhead: tokens.warn, over: tokens.neg }[status];
  const series: EChartsOption['series'] = [
    {
      name: 'Spent',
      type: 'line',
      data: spent,
      symbol: 'none',
      smooth: 0.2,
      lineStyle: { color, width: 2 },
      areaStyle: { color, opacity: 0.08 },
    },
  ];
  if (budgetCents > 0) {
    series.push({ name: 'Budget pace', type: 'line', data: pace, symbol: 'none', lineStyle: { type: 'dashed', width: 1, color: tokens.subtle } });
  }
  return {
    animation: !opts.reduceMotion,
    grid: { left: 0, right: 0, top: 8, bottom: 0 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '' : money(Number(v))) },
    xAxis: { type: 'category', data: days, show: false, boundaryGap: false },
    yAxis: { type: 'value', show: false, min: 0 },
    series,
  };
}
