import { describe, expect, it } from 'vitest';
import { lightOrange, paceStatus, periodBars, spendingPace, stackedCategoryBars } from './period-charts';
import { readChartTokens } from './tokens';

const tokens = readChartTokens(null);
type Bar = { value: number | null; itemStyle?: { color: string }; label?: { show: boolean; formatter: string } };
type Series = { name: string; type: string; data: unknown[]; stack?: string; lineStyle?: { type: string; color: string }; step?: string };
const seriesOf = (opt: { series?: unknown }) => opt.series as Series[];

describe('periodBars', () => {
  const points = [
    { label: 'Sep', valueCents: 250000 },
    { label: 'Oct', valueCents: -40000 },
    { label: 'Nov', valueCents: 120000 },
    { label: 'Dec', valueCents: 0 },
  ];

  it('colors bars by sign: green for money gained, red for money lost', () => {
    const bars = seriesOf(periodBars(points, tokens, { nowIndex: 2, color: 'sign' }))[0].data as Bar[];
    expect(bars[0].itemStyle?.color).toBe(tokens.pos);
    expect(bars[1].itemStyle?.color).toBe(tokens.neg);
  });

  it('uses one color when given a color', () => {
    const bars = seriesOf(periodBars(points, tokens, { nowIndex: 2, color: tokens.income }))[0].data as Bar[];
    expect(bars).toHaveLength(4);
    expect(bars.slice(0, 3).every((b) => b.itemStyle?.color === tokens.income)).toBe(true);
  });

  it('tags the current period with "Now" and nothing else', () => {
    const bars = seriesOf(periodBars(points, tokens, { nowIndex: 2, color: 'sign' }))[0].data as Bar[];
    expect(bars[2].label).toMatchObject({ show: true, formatter: 'Now' });
    expect(bars.filter((b) => b.label?.show)).toHaveLength(1);
  });

  it('leaves periods after now empty but keeps their axis labels', () => {
    const opt = periodBars(points, tokens, { nowIndex: 2, color: 'sign' });
    const bars = seriesOf(opt)[0].data as Bar[];
    expect(bars[3].value).toBeNull();
    expect((opt.xAxis as { data: string[] }).data).toEqual(['Sep', 'Oct', 'Nov', 'Dec']);
  });

  it('draws the previous period as a dashed line', () => {
    const opt = periodBars(points, tokens, { nowIndex: 2, color: 'sign', previous: [100, 200, 300, 400] });
    const prev = seriesOf(opt).find((s) => s.name === 'Previous period');
    expect(prev?.type).toBe('line');
    expect(prev?.lineStyle?.type).toBe('dashed');
    expect(prev?.data).toEqual([100, 200, 300, 400]);
  });

  it('has no previous-period line when none is given', () => {
    expect(seriesOf(periodBars(points, tokens, { nowIndex: 2, color: 'sign' }))).toHaveLength(1);
  });
});

describe('stackedCategoryBars', () => {
  const labels = ['Sep', 'Oct', 'Nov', 'Dec'];
  const categories = [
    { name: 'Rent', color: '#4c85ee', values: [220000, 220000, 220000, 0] },
    { name: 'Groceries', color: '#e8743b', values: [30000, 25000, 12000, 0] },
  ];

  it('stacks one series per category in its own color', () => {
    const s = seriesOf(stackedCategoryBars(labels, categories, tokens, { nowIndex: 2 }));
    expect(s.map((x) => x.name)).toEqual(['Rent', 'Groceries']);
    expect(s.every((x) => x.type === 'bar' && x.stack === 'spend')).toBe(true);
    expect((s[1] as unknown as { itemStyle: { color: string } }).itemStyle.color).toBe('#e8743b');
  });

  it('puts the "Now" tag on top of the stack in the current period only', () => {
    const s = seriesOf(stackedCategoryBars(labels, categories, tokens, { nowIndex: 2 }));
    const top = s[1].data as Bar[];
    expect(top[2].label).toMatchObject({ show: true, formatter: 'Now' });
    expect((s[0].data as Bar[]).some((b) => b.label?.show)).toBe(false);
    expect(top.filter((b) => b.label?.show)).toHaveLength(1);
  });

  it('leaves periods after now empty', () => {
    const s = seriesOf(stackedCategoryBars(labels, categories, tokens, { nowIndex: 2 }));
    expect((s[0].data as Bar[])[3].value).toBeNull();
  });

  it('adds the dashed previous-period line when given', () => {
    const s = seriesOf(stackedCategoryBars(labels, categories, tokens, { nowIndex: 2, previous: [1, 2, 3, 4] }));
    expect(s.at(-1)?.name).toBe('Previous period');
  });
});

describe('spendingPace', () => {
  type Line = { name: string; data: (number | null)[]; lineStyle: { type?: string; color: string } };
  const lines = (o: { series?: unknown }) => o.series as Line[];

  it('draws spend so far, then nothing for the rest of the month', () => {
    const s = lines(spendingPace([100, 300, 300], 5, 1000, tokens));
    expect(s[0].name).toBe('Spent');
    expect(s[0].data).toEqual([100, 300, 300, null, null]);
  });

  it('draws the budget as a dashed even pace from zero to the full budget at month end', () => {
    const pace = lines(spendingPace([100], 4, 1000, tokens)).find((x) => x.name === 'Budget pace')!;
    expect(pace.lineStyle.type).toBe('dashed');
    expect(pace.data).toEqual([250, 500, 750, 1000]);
  });

  it("colors the spend line by pace: green under, light orange up to 20% ahead, dark orange beyond, red over budget", () => {
    // Day 1 of 4 on a 1000 budget: the pace is 250.
    expect(lines(spendingPace([200], 4, 1000, tokens))[0].lineStyle.color).toBe(tokens.pos);
    expect(lines(spendingPace([290], 4, 1000, tokens))[0].lineStyle.color).toBe(lightOrange(tokens.warn));
    expect(lines(spendingPace([600], 4, 1000, tokens))[0].lineStyle.color).toBe(tokens.warn);
    expect(lines(spendingPace([1100], 4, 1000, tokens))[0].lineStyle.color).toBe(tokens.neg);
  });

  it('stays the accent color without a budget', () => {
    expect(lines(spendingPace([100], 4, 0, tokens))[0].lineStyle.color).toBe(tokens.accent);
  });

  it('has no pace line without a budget', () => {
    expect(lines(spendingPace([100], 4, 0, tokens))).toHaveLength(1);
  });
});

describe('paceStatus', () => {
  it('compares spend with the even pace and the budget', () => {
    expect(paceStatus(250, 250, 1000)).toBe('under');
    expect(paceStatus(300, 250, 1000)).toBe('ahead');
    expect(paceStatus(301, 250, 1000)).toBe('farAhead');
    expect(paceStatus(1001, 1000, 1000)).toBe('over');
    expect(paceStatus(10, 0, 0)).toBe('none');
  });
});
