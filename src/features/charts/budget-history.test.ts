import { describe, expect, it } from 'vitest';
import { budgetHistory, monthInitial } from './budget-history';
import { readChartTokens } from './tokens';

const tokens = readChartTokens(null);
type Bar = { value: number; itemStyle: { color: string } };
type Point = { value: number | null; label?: { show: boolean; formatter: string } };
type Series = { name: string; type: string; data: unknown[]; step?: string | boolean; lineStyle?: { color: string } };

const months = [
  { month: '2026-08', spentCents: 30000, budgetCents: null },
  { month: '2026-09', spentCents: 40000, budgetCents: 50000 },
  { month: '2026-10', spentCents: 61500, budgetCents: 50000 },
  { month: '2026-11', spentCents: 20000, budgetCents: 461500 },
];

describe('monthInitial', () => {
  it('maps YYYY-MM to the month initial', () => {
    expect(['2026-01', '2026-05', '2026-09', '2026-12'].map(monthInitial)).toEqual(['J', 'M', 'S', 'D']);
  });
});

describe('budgetHistory', () => {
  const opt = budgetHistory(months, tokens);
  const series = opt.series as Series[];
  const bars = series.find((s) => s.type === 'bar')!.data as Bar[];
  const line = series.find((s) => s.type === 'line')!;

  it('labels the axis with month initials', () => {
    expect((opt.xAxis as { data: string[] }).data).toEqual(['A', 'S', 'O', 'N']);
  });

  it('colors months: no budget blue, under green, over orange, current yellow', () => {
    expect(bars.map((b) => b.itemStyle.color)).toEqual([tokens.accent, tokens.pos, tokens.warn, tokens.current]);
  });

  it('draws the budget as a stepped line, absent where there was no budget', () => {
    expect(line.step).toBeTruthy();
    expect((line.data as Point[]).map((p) => p.value)).toEqual([null, 50000, 50000, 461500]);
  });

  it('tags the latest budget value at the end of the line', () => {
    const pts = line.data as Point[];
    expect(pts.at(-1)?.label).toMatchObject({ show: true, formatter: '$4,615' });
    // ECharts only draws a line label on a point that has a symbol.
    expect((pts.at(-1) as { symbol?: string }).symbol).toBe('circle');
    expect(pts.filter((p) => p.label?.show)).toHaveLength(1);
  });

  it('has no budget line when no month has a budget', () => {
    const none = budgetHistory([{ month: '2026-10', spentCents: 100, budgetCents: null }], tokens);
    expect((none.series as Series[]).some((s) => s.type === 'line')).toBe(false);
  });
});

describe('budgetHistory tooltip and picked month', () => {
  it('names the whole month and shows dollars, not cents', () => {
    const opt = budgetHistory(months, tokens) as unknown as { tooltip: { formatter: (p: unknown) => string } };
    const html = opt.tooltip.formatter([{ dataIndex: 0, seriesName: 'Spent', value: 30000, marker: '' }]);
    expect(html).toContain('August 2026');
    expect(html).toContain('$300.00');
    expect(html).not.toContain('30,000');
  });

  it('outlines the picked month and fades the others', () => {
    const opt = budgetHistory(months, tokens, { picked: '2026-09' });
    const bars = (opt.series as Series[]).find((s) => s.type === 'bar')!.data as { itemStyle: { opacity?: number; borderColor?: string; borderWidth?: number } }[];
    expect(bars[1].itemStyle.borderWidth).toBeGreaterThan(0);
    expect(bars[0].itemStyle.opacity).toBeLessThan(1);
    expect(bars[1].itemStyle.opacity ?? 1).toBe(1);
  });
});
