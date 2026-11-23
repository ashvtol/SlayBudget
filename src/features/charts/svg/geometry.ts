// Pure geometry for the SVG charts: where each month's bar goes, round axis ticks, and which month the pointer is
// over. Amounts are integer cents; labels are in the display currency.

import { localeFor } from '@/lib/format';
import { displayCurrency } from '@/features/currency/currency-store';

export interface Slot {
  /** The month's slot (the pointer anywhere in it means that month). */
  x: number;
  slotWidth: number;
  /** The narrow bar centered in the slot. */
  barX: number;
  barWidth: number;
  center: number;
}

const MIN_BAR = 3;
const MAX_BAR = 24;

/** One slot per month across `width`, each with a narrow bar (a fraction of the slot, 3 to 24 px) in the middle. */
export function bandLayout(count: number, width: number, opts: { barRatio?: number } = {}): Slot[] {
  if (count <= 0) return [];
  const slotWidth = Math.max(0, width) / count;
  const barWidth = Math.min(slotWidth, Math.min(MAX_BAR, Math.max(MIN_BAR, Math.round(slotWidth * (opts.barRatio ?? 0.18)))));
  return Array.from({ length: count }, (_, i) => {
    const x = i * slotWidth;
    return { x, slotWidth, barX: x + (slotWidth - barWidth) / 2, barWidth, center: x + slotWidth / 2 };
  });
}

/** The month under the pointer (`px` from the plot's left edge), or null outside. */
export function indexAt(px: number, layout: Slot[]): number | null {
  if (layout.length === 0 || px < 0) return null;
  const i = Math.floor(px / layout[0].slotWidth);
  return i < layout.length ? i : null;
}

/** "$3K", "-$2K", "$0" in the display currency. */
export function axisMoney(cents: number): string {
  return new Intl.NumberFormat(localeFor(displayCurrency()), {
    style: 'currency',
    currency: displayCurrency(),
    notation: 'compact',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

export interface ValueScale {
  y(cents: number): number;
  ticks: { value: number; y: number; label: string }[];
  /** The y of $0 (the baseline bars grow from). */
  zero: number;
}

const MAX_INTERVALS = 3;

/** The smallest round step (1, 2 or 5 × 10ⁿ) that covers lo..hi in at most 3 intervals. */
function niceStep(lo: number, hi: number): number {
  let magnitude = 10 ** Math.floor(Math.log10((hi - lo) / MAX_INTERVALS));
  for (;;) {
    for (const m of [1, 2, 5]) {
      const step = m * magnitude;
      if (Math.ceil(hi / step) - Math.floor(lo / step) <= MAX_INTERVALS) return step;
    }
    magnitude *= 10;
  }
}

/** A y for each amount over `height` (top = 0), with round ticks that always include $0. */
export function valueScale(values: number[], height: number): ValueScale {
  const lo0 = Math.min(0, ...values);
  const hi0 = Math.max(0, ...values);
  if (lo0 === hi0) {
    // Nothing to show: a flat baseline at the bottom.
    const y = () => height;
    return { y, zero: height, ticks: [{ value: 0, y: height, label: axisMoney(0) }] };
  }
  const step = niceStep(lo0, hi0);
  const lo = Math.floor(lo0 / step) * step;
  const hi = Math.ceil(hi0 / step) * step;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  const ticks = [];
  for (let v = lo; v <= hi; v += step) ticks.push({ value: v, y: y(v), label: axisMoney(v) });
  return { y, zero: y(0), ticks };
}
