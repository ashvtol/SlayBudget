import { Segmented } from '@/components/segmented';
import { RANGE_LABELS, useAnalyticsStore } from './analytics-store';

/** Segmented time-range control. Changing it triggers a reload via the store. */
export function RangeSelector() {
  const range = useAnalyticsStore((s) => s.range);
  const setRange = useAnalyticsStore((s) => s.setRange);
  return <Segmented aria-label="Time range" options={RANGE_LABELS} value={range} onChange={(id) => void setRange(id)} />;
}
