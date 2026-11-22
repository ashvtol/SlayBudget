import { IconArrowDownRight, IconArrowUpRight, IconEqual } from './icons';

/** Percentage change from `previous` to `current`, or null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * The small tinted change badge ("↗ 12.50%"). `upIsGood` decides the color:
 * income going up is good, spending going up is bad.
 */
export function DeltaBadge({ pct, upIsGood = true }: { pct: number | null; upIsGood?: boolean }) {
  const flat = pct == null || Math.abs(pct) < 0.005;
  const up = !flat && (pct as number) > 0;
  const good = flat ? null : up === upIsGood;
  const color = good == null ? 'var(--muted)' : good ? 'var(--pos)' : 'var(--neg)';
  const label = pct == null ? 'n/a' : `${Math.min(Math.abs(pct), 999).toFixed(2)}%`;
  const Icon = flat ? IconEqual : up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
      style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
      aria-label={pct == null ? 'No comparison' : `${up ? 'Up' : flat ? 'Unchanged' : 'Down'} ${label}`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}
