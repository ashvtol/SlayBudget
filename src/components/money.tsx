import { useLayoutEffect, useRef, useState } from 'react';
import { localeFor } from '@/lib/format';
import { useDisplayStore } from '@/lib/stores/display-store';
import { useCurrencyStore } from '@/features/currency/currency-store';

// Amounts in the Copilot style: the currency symbol is small and raised,
// digits are tabular. Cents are integers; the sign is the caller's choice.

export type MoneyTone = 'default' | 'pos' | 'neg' | 'muted' | 'auto';

const TONE: Record<Exclude<MoneyTone, 'auto'>, string> = {
  default: 'var(--text)',
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  muted: 'var(--muted)',
};

/** Split a formatted amount into its currency symbol and the number. */
export function moneyParts(cents: number, currency: string, opts: { decimals?: boolean } = {}): { symbol: string; number: string } {
  const decimals = opts.decimals ?? true;
  const parts = new Intl.NumberFormat(localeFor(currency), {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).formatToParts(Math.abs(cents) / 100);
  const symbol = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('').trim();
  const number = parts.filter((p) => p.type !== 'currency' && p.type !== 'literal').map((p) => p.value).join('');
  return { symbol, number };
}

export function Money({
  cents,
  currency: given,
  tone = 'default',
  sign = 'none',
  decimals = true,
  className = '',
}: {
  cents: number;
  currency?: string;
  /** 'auto' shows money in as positive (green) and money out as default text. */
  tone?: MoneyTone;
  /** 'negative' prefixes a minus for negative amounts; 'always' adds + or -. */
  sign?: 'none' | 'negative' | 'always';
  decimals?: boolean;
  className?: string;
}) {
  const display = useCurrencyStore((s) => s.displayCurrency);
  const currency = given ?? display;
  const { symbol, number } = moneyParts(cents, currency, { decimals });
  const roll = useRoll(number, `${currency}${decimals}`);
  const resolved = tone === 'auto' ? (cents > 0 ? 'pos' : 'default') : tone;
  const prefix = sign === 'always' ? (cents > 0 ? '+' : cents < 0 ? '-' : '') : sign === 'negative' && cents < 0 ? '-' : '';
  return (
    <span className={`tabular-nums whitespace-nowrap ${className}`} style={{ color: TONE[resolved] }} aria-label={roll ? `${prefix}${symbol}${number}` : undefined}>
      {prefix}
      <span className="money-symbol" style={{ fontSize: '0.62em', verticalAlign: '0.48em', marginRight: '0.08em', fontWeight: 600 }}>
        {symbol}
      </span>
      {roll ? <Rolling from={roll.from} to={number} /> : number}
    </span>
  );
}

const ROLL_MS = 420;
const STAGGER_MS = 35;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** When the shown number changes (same currency), what it changed from, until the roll has played. */
function useRoll(number: string, unit: string): { from: string } | null {
  const rolling = useDisplayStore((s) => s.rolling);
  const last = useRef({ number, unit });
  const [roll, setRoll] = useState<{ from: string; to: string } | null>(null);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = { number, unit };
    if (prev.number === number || prev.unit !== unit || !rolling || reducedMotion()) return;
    setRoll({ from: prev.number, to: number });
    const done = setTimeout(() => setRoll(null), ROLL_MS + STAGGER_MS * number.length + 50);
    return () => clearTimeout(done);
  }, [number, unit, rolling]);
  return roll && roll.to === number ? roll : null;
}

/** Digits that changed roll: the old one leaves upward while the new one comes up from below, right to left. */
function Rolling({ from, to }: { from: string; to: string }) {
  const width = Math.max(from.length, to.length);
  const a = from.padStart(width);
  const b = to.padStart(width);
  return (
    <span aria-hidden="true">
      {[...b].map((ch, i) => {
        const old = a[i];
        if (old === ch) return <span key={i}>{ch}</span>;
        const fromRight = width - 1 - i;
        return (
          <span key={i} data-roll className="roll-slot" style={{ ['--roll-delay' as string]: `${fromRight * STAGGER_MS}ms` }}>
            <span data-roll-out aria-hidden="true">{old.trim()}</span>
            <span data-roll-in>{ch.trim()}</span>
          </span>
        );
      })}
    </span>
  );
}
