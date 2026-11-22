import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

/**
 * Minimal declarative ECharts wrapper: inits a chart into a div, pushes the
 * option on change, and resizes with its container. The option is built by the
 * pure builders in options.ts, so this component stays logic-free.
 */
export function Chart({
  option,
  height = 240,
  ariaLabel,
  merge = false,
  resetKey,
  onRendered,
  onClick,
}: {
  option: EChartsOption;
  /** Pixels, or any CSS height (e.g. "100%") when the chart fills its container. */
  height?: number | string;
  ariaLabel?: string;
  /** Merge new options into the chart so data changes animate (treemap reshaping) instead of redrawing. */
  merge?: boolean;
  /** When this changes, the chart is redrawn from scratch even in merge mode (a different picture). */
  resetKey?: string;
  /** Called with the ECharts instance after each render settles (e.g. to fit labels to tiles). */
  onRendered?: (chart: echarts.ECharts) => void;
  /** Called when a data item is clicked (e.g. a month bar). */
  onClick?: (params: { componentType?: string; dataIndex: number; seriesName?: string }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const onRenderedRef = useRef(onRendered);
  const onClickRef = useRef(onClick);
  useEffect(() => {
    onRenderedRef.current = onRendered;
    onClickRef.current = onClick;
  }, [onRendered, onClick]);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.on('finished', () => onRenderedRef.current?.(chart));
    chart.on('click', (params) => onClickRef.current?.(params as { componentType?: string; dataIndex: number; seriesName?: string }));
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  const lastResetKey = useRef<string | undefined>(resetKey);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const reset = lastResetKey.current !== resetKey;
    lastResetKey.current = resetKey;
    // Merge keeps series with the same id (so changes animate) and drops series that are gone;
    // a new reset key, or no merge, replaces everything.
    if (merge && !reset) chart.setOption(option, { replaceMerge: ['series'] });
    else chart.setOption(option, true);
  }, [option, merge, resetKey]);

  return <div ref={ref} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />;
}
