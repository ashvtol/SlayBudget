// Which month (or day) the pointer is over, as plain React state: it changes the moment the pointer moves, so nothing
// trails behind it. The same hover moves with ← → while the chart has focus (Escape or leaving clears it).

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface ChartHover {
  index: number | null;
  set(index: number | null): void;
  /** Spread onto the chart's <svg>. */
  bind: {
    tabIndex: number;
    onPointerMove(e: PointerEvent<SVGSVGElement>): void;
    onPointerLeave(): void;
    onKeyDown(e: KeyboardEvent<SVGSVGElement>): void;
    onBlur(): void;
  };
}

export function useChartHover(
  count: number,
  indexFromPx: (px: number) => number | null,
  opts: { plotLeft?: number; onHover?: (index: number | null) => void } = {},
): ChartHover {
  const [index, setIndex] = useState<number | null>(null);
  const latest = useRef<number | null>(null);
  const { plotLeft = 0, onHover } = opts;
  const set = useCallback(
    (next: number | null) => {
      if (latest.current === next) return;
      latest.current = next;
      setIndex(next);
      onHover?.(next);
    },
    [onHover],
  );
  return {
    index,
    set,
    bind: {
      tabIndex: 0,
      onPointerMove(e) {
        const rect = e.currentTarget.getBoundingClientRect();
        set(indexFromPx(e.clientX - rect.left - plotLeft));
      },
      onPointerLeave() {
        set(null);
      },
      onKeyDown(e) {
        if (count === 0) return;
        if (e.key === 'ArrowRight') set(index == null ? 0 : Math.min(count - 1, index + 1));
        else if (e.key === 'ArrowLeft') set(index == null ? count - 1 : Math.max(0, index - 1));
        else if (e.key === 'Escape') set(null);
        else return;
        e.preventDefault();
      },
      onBlur() {
        set(null);
      },
    },
  };
}
