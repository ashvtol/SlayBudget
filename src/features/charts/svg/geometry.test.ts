import { describe, expect, it } from 'vitest';
import { axisMoney, bandLayout, indexAt, valueScale } from './geometry';

describe('bandLayout: one slot per month, a narrow bar centered in each', () => {
  it('splits the width evenly and centers the bars', () => {
    const l = bandLayout(4, 400);
    expect(l.map((s) => [s.x, s.slotWidth, s.center])).toEqual([
      [0, 100, 50],
      [100, 100, 150],
      [200, 100, 250],
      [300, 100, 350],
    ]);
    expect(l[0].barX + l[0].barWidth / 2).toBe(50);
  });

  it('keeps bars narrow like Copilot (a fraction of the slot), between a minimum and a maximum', () => {
    expect(bandLayout(12, 1200)[0].barWidth).toBe(18); // 100 px slots → 18%
    expect(bandLayout(24, 120)[0].barWidth).toBe(3); // very narrow: never thinner than 3 px
    expect(bandLayout(2, 2000)[0].barWidth).toBe(24); // very wide: never fatter than 24 px
    expect(bandLayout(12, 1200, { barRatio: 0.4 })[0].barWidth).toBe(24);
  });

  it('nothing to lay out', () => {
    expect(bandLayout(0, 400)).toEqual([]);
    expect(bandLayout(3, 0).every((s) => s.barWidth >= 0)).toBe(true);
  });
});

describe('indexAt: which month the pointer is over', () => {
  const l = bandLayout(4, 400);
  it('anywhere in a slot counts, including the gaps beside the bar', () => {
    expect([indexAt(0, l), indexAt(49, l), indexAt(99.9, l), indexAt(100, l), indexAt(399, l)]).toEqual([0, 0, 0, 1, 3]);
  });
  it('outside the chart is nothing', () => {
    expect([indexAt(-1, l), indexAt(400, l), indexAt(10, [])]).toEqual([null, null, null]);
  });
});

describe('valueScale: round ticks and a y for each amount', () => {
  it('all positive: round steps (1, 2 or 5 × 10ⁿ, at most 3 of them) up to at least the largest, $0 at the bottom', () => {
    const s = valueScale([120000, 250000, 180000], 100);
    expect(s.ticks.map((t) => t.label)).toEqual(['$0', '$1K', '$2K', '$3K']);
    expect(s.y(0)).toBe(100);
    expect(s.y(300000)).toBe(0);
  });

  it('positive and negative: $0 sits inside, with a round tick below', () => {
    const s = valueScale([280000, -150000, 90000], 120);
    const labels = s.ticks.map((t) => t.label);
    expect(labels).toContain('$0');
    expect(labels[0]).toBe('-$2K');
    expect(s.y(0)).toBeGreaterThan(0);
    expect(s.y(0)).toBeLessThan(120);
    expect(s.y(-200000)).toBe(120);
  });

  it('only negative months hang below $0 at the top', () => {
    const s = valueScale([-50000, -120000], 100);
    expect(s.y(0)).toBe(0);
    expect(s.ticks.at(-1)!.label).toBe('$0');
  });

  it('all zero (or nothing) draws a flat baseline without dividing by zero', () => {
    for (const values of [[0, 0, 0], []]) {
      const s = valueScale(values, 100);
      expect(s.y(0)).toBe(100);
      expect(Number.isFinite(s.y(5000))).toBe(true);
      expect(s.ticks.map((t) => t.label)).toEqual(['$0']);
    }
  });

  it('one huge month still gets a few round ticks', () => {
    const s = valueScale([1000, 2000, 2_450_000], 100);
    expect(s.ticks.length).toBeLessThanOrEqual(4);
    expect(s.ticks.at(-1)!.value).toBeGreaterThanOrEqual(2_450_000);
  });
});

describe('axisMoney: short labels in the display currency', () => {
  it('compacts thousands', () => {
    expect([axisMoney(300000), axisMoney(-200000), axisMoney(0), axisMoney(2_500_000)]).toEqual(['$3K', '-$2K', '$0', '$25K']);
  });
});
