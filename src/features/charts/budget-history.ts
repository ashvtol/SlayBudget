// Copilot's per-category budget history: monthly bars against a stepped budget line.

import type { EChartsOption } from 'echarts';
import type { ChartTokens } from './tokens';
import { localeFor } from '@/lib/format';
import { displayCurrency } from '@/features/currency/currency-store';

export interface BudgetMonth {
  month: string; // YYYY-MM
  spentCents: number;
  budgetCents: number | null;
}

const INITIALS = 'JFMAMJJASOND';

export function monthInitial(month: string): string {
  return INITIALS[Number(month.slice(5, 7)) - 1] ?? '';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;
const dollars = (cents: number) => new Intl.NumberFormat(localeFor(displayCurrency()), { style: 'currency', currency: displayCurrency() }).format(cents / 100);

const wholeDollars = (cents: number) =>
  new Intl.NumberFormat(localeFor(displayCurrency()), { style: 'currency', currency: displayCurrency(), maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Bars: blue with no budget, green under, orange over, yellow for the current
 * (last) month. The budget is a stepped line tagged with its latest value.
 */
export function budgetHistory(months: BudgetMonth[], tokens: ChartTokens, opts: { reduceMotion?: boolean; /** A month ('YYYY-MM') picked on the chart: outlined, the rest faded. */ picked?: string } = {}): EChartsOption {
  const lastIndex = months.length - 1;
  const bars = months.map((m, i) => {
    let color = tokens.accent;
    if (i === lastIndex) color = tokens.current;
    else if (m.budgetCents != null) color = m.spentCents > m.budgetCents ? tokens.warn : tokens.pos;
    if (!opts.picked) return { value: m.spentCents, itemStyle: { color, borderRadius: 2 } };
    return m.month === opts.picked
      ? { value: m.spentCents, itemStyle: { color, borderRadius: 2, borderColor: tokens.text, borderWidth: 1.5 } }
      : { value: m.spentCents, itemStyle: { color, borderRadius: 2, opacity: 0.4 } };
  });

  const series: EChartsOption['series'] = [{ name: 'Spent', type: 'bar', data: bars, barWidth: '55%' }];

  if (months.some((m) => m.budgetCents != null)) {
    const latest = [...months].reverse().find((m) => m.budgetCents != null)!.budgetCents as number;
    const lastBudgeted = months.map((m) => m.budgetCents != null).lastIndexOf(true);
    series.push({
      name: 'Budget',
      type: 'line',
      step: 'middle',
      symbol: 'none',
      lineStyle: { color: tokens.text, width: 1.5 },
      data: months.map((m, i) => ({
        value: m.budgetCents,
        ...(i === lastBudgeted
          ? {
              // A tiny symbol so ECharts draws the label (line labels need a symbol).
              symbol: 'circle',
              symbolSize: 1,
              label: {
                show: true,
                formatter: wholeDollars(latest),
                position: 'right' as const,
                color: tokens.panel,
                backgroundColor: tokens.text,
                fontWeight: 600,
                fontSize: 11,
                padding: [3, 6],
                borderRadius: 3,
              },
            }
          : {}),
      })),
    });
  }

  return {
    animation: !opts.reduceMotion,
    grid: { left: 0, right: 56, top: 12, bottom: 0, containLabel: true },
    tooltip: {
      trigger: 'axis',
      // The whole month name and dollars (the axis shows initials, the data is cents).
      formatter: (params: unknown) => {
        const list = (Array.isArray(params) ? params : [params]) as { dataIndex: number; seriesName: string; value: number | null; marker?: string }[];
        const m = months[list[0]?.dataIndex ?? -1];
        if (!m) return '';
        const lines = list.filter((p) => p.value != null).map((p) => `${p.marker ?? ''}${p.seriesName} <b>${dollars(p.value as number)}</b>`);
        return [`<b>${monthName(m.month)}</b>`, ...lines].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((m) => monthInitial(m.month)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: tokens.muted, fontSize: 10, fontWeight: 600 },
    },
    yAxis: { type: 'value', show: false },
    series,
  };
}
