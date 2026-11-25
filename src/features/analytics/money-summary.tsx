// The pieces the Recurrings and Categories summaries share: a change against an earlier amount, a thick share ring,
// and this year against last.
import { Money } from '@/components/money';
import type { SpendTrend } from './spend-trend';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (month: string) => `${SHORT[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** "↑ 4% vs October so far ($790)": spending up is red, down is green; the same is plain. */
export function Change({ now, before, against, none }: { now: number; before: number; against: string; none: string }) {
  if (now === before) return <span style={{ color: 'var(--muted)' }}>Same as {against}</span>;
  if (before === 0) return <span style={{ color: 'var(--muted)' }}>{none}</span>;
  const pct = Math.round(((now - before) * 100) / before);
  const up = now > before;
  return (
    <span>
      <span className="font-semibold" style={{ color: up ? 'var(--neg)' : 'var(--pos)' }}>
        {up ? '↑' : '↓'} {Math.abs(pct)}%
      </span>
      <span style={{ color: 'var(--muted)' }}>
        {' '}vs {against} (<Money cents={before} decimals={false} />)
      </span>
    </span>
  );
}

/** A thick ring: `value` as a share of `total` in `color` on the plain track, the percent and a word inside. */
export function ShareRing({ value, total, label, word, part, color }: { value: number; total: number; label: string; word: string; part: string; color: string }) {
  const size = 104;
  const thickness = 22;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const share = total > 0 ? value / total : 0;
  const arc = Math.min(1, Math.max(0, share)) * c;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
      {arc > 0 && (
        <circle
          data-part={part}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${arc} ${c - arc}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fontSize="17" fontWeight="650" fill="var(--text)">
        {Math.round(share * 100)}%
      </text>
      <text x="50%" y="64%" textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--muted)">
        {word}
      </text>
    </svg>
  );
}

/** This year against the same date last year, the monthly average and last year's total. */
export function YearRows({ label, trend, year }: { label: string; trend: SpendTrend; year: number }) {
  return (
    <table aria-label={label} className="w-full border-t text-[13px]" style={{ borderColor: 'var(--line)' }}>
      <tbody>
        <tr>
          <th scope="row" className="pt-4 text-left font-normal" style={{ color: 'var(--muted)' }}>This year</th>
          <td className="pt-4 text-right font-semibold"><Money cents={trend.yearToDateCents} decimals={false} /></td>
          <td className="w-[55%] pl-6 pt-4 text-[12px]">
            <Change now={trend.yearToDateCents} before={trend.lastYearToDateCents} against="this time last year" none="Nothing last year to compare" />
          </td>
        </tr>
        <tr>
          <th scope="row" className="pt-1.5 text-left font-normal" style={{ color: 'var(--muted)' }}>Monthly average</th>
          <td className="pt-1.5 text-right font-semibold"><Money cents={trend.monthlyAvgCents} decimals={false} /></td>
          <td className="pl-6 pt-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>over the last 12 months</td>
        </tr>
        <tr>
          <th scope="row" className="pt-1.5 text-left font-normal" style={{ color: 'var(--muted)' }}>Last year</th>
          <td className="pt-1.5 text-right font-semibold"><Money cents={trend.lastYearCents} decimals={false} /></td>
          <td className="pl-6 pt-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>all of {year - 1}</td>
        </tr>
      </tbody>
    </table>
  );
}
