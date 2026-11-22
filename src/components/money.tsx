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
  const parts = new Intl.NumberFormat('en-US', {
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
  currency = 'USD',
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
  const { symbol, number } = moneyParts(cents, currency, { decimals });
  const resolved = tone === 'auto' ? (cents > 0 ? 'pos' : 'default') : tone;
  const prefix = sign === 'always' ? (cents > 0 ? '+' : cents < 0 ? '-' : '') : sign === 'negative' && cents < 0 ? '-' : '';
  return (
    <span className={`tabular-nums whitespace-nowrap ${className}`} style={{ color: TONE[resolved] }}>
      {prefix}
      <span className="money-symbol" style={{ fontSize: '0.62em', verticalAlign: '0.48em', marginRight: '0.08em', fontWeight: 600 }}>
        {symbol}
      </span>
      {number}
    </span>
  );
}
