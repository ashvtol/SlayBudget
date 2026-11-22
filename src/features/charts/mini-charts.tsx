// Small SVG charts: the summary ring (spent vs budget, paid vs left) and the
// sparkline used in list rows. Plain SVG keeps them light enough for long lists.

export function ringFraction(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

export function Ring({
  value,
  total,
  label,
  size = 68,
  thickness = 14,
  color = 'var(--accent)',
}: {
  value: number;
  total: number;
  label: string;
  size?: number;
  thickness?: number;
  color?: string;
}) {
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = ringFraction(value, total) * circumference;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
      <circle
        data-part="arc"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeDasharray={`${filled} ${circumference - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** Polyline points for `values` scaled into a w by h box (min at the bottom). */
export function sparkPoints(values: number[], w: number, h: number): string {
  if (values.length === 0) return '';
  const series = values.length === 1 ? [values[0], values[0]] : values;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const step = w / (series.length - 1);
  return series
    .map((v, i) => {
      const y = max === min ? h / 2 : h - ((v - min) / (max - min)) * h;
      return `${Math.round(i * step * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(' ');
}

export function Sparkline({ values, width = 64, height = 18 }: { values: number[]; width?: number; height?: number }) {
  const up = values.length < 2 || values[values.length - 1] >= values[0];
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`-1 -1 ${width + 2} ${height + 2}`}>
      <polyline points={sparkPoints(values, width, height)} fill="none" stroke={up ? 'var(--pos)' : 'var(--neg)'} strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}
