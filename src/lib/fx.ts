// Built-in exchange rates and display conversion: a mirror of crates/core/src/fx.rs for the in-memory IPC (tests and
// the preview). The app does this in Rust. Rates are the ECB's monthly averages built into the app (no network).
import ratesCsv from '../../crates/core/data/fx-monthly.csv?raw';

export interface BuiltinRates {
  latestMonth(): string;
  currencies(): string[];
  perEuro(currency: string, month: string): number | null;
  rate(from: string, to: string, month: string): number | null;
}

function parse(csv: string): BuiltinRates {
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(',').slice(1);
  const months: string[] = [];
  const series = new Map<string, (number | null)[]>(cols.map((c) => [c, []]));
  for (const line of lines) {
    const cells = line.split(',');
    months.push(cells[0]);
    cols.forEach((c, i) => {
      const v = Number(cells[i + 1]);
      series.get(c)!.push(cells[i + 1] && v > 0 ? v : null);
    });
  }
  const firstMonth = (c: string) => (c === 'EUR' ? months[0] : months[series.get(c)?.findIndex((v) => v != null) ?? -1]);
  const perEuro = (c: string, month: string): number | null => {
    if (c === 'EUR') return 1;
    const s = series.get(c);
    if (!s) return null;
    let at = months.findIndex((m) => m > month);
    if (at < 0) at = months.length;
    for (let i = at - 1; i >= 0; i--) if (s[i] != null) return s[i];
    for (let i = at; i < s.length; i++) if (s[i] != null) return s[i];
    return null;
  };
  return {
    latestMonth: () => months[months.length - 1],
    currencies: () => [...cols, 'EUR'].sort(),
    perEuro,
    rate(from, to, month) {
      if (from === to) return 1;
      const a = firstMonth(from);
      const b = firstMonth(to);
      if (!a || !b) return null;
      const start = a > b ? a : b;
      const m = month < start ? start : month;
      const t = perEuro(to, m);
      const f = perEuro(from, m);
      return t != null && f != null ? t / f : null;
    },
  };
}

let rates: BuiltinRates | null = null;
export const builtinRates = (): BuiltinRates => (rates ??= parse(ratesCsv));

export type Basis = 'month' | 'latest';
export interface Display {
  currency: string;
  basis: Basis;
}

/** Display conversions, as fx::Shown: transactions at their month, budgets and bill amounts at the latest month. */
export function shownFor(display: Display, budgetCurrency: string, baseCurrency: string) {
  const r = builtinRates();
  const monthFor = (on: string) => (display.basis === 'latest' ? r.latestMonth() : on.slice(0, 7));
  const latest = (cents: number, from: string, to: string) => {
    const rate = from === to ? 1 : r.rate(from, to, r.latestMonth());
    return rate == null ? cents : Math.round(cents * rate);
  };
  return {
    display,
    budgetCurrency,
    plain: display.currency === budgetCurrency && display.currency === baseCurrency,
    transaction(cents: number, currency: string, on: string): number {
      const rate = currency === display.currency ? null : r.rate(currency, display.currency, monthFor(on));
      return rate == null ? cents : Math.round(cents * rate);
    },
    back(cents: number, currency: string, on: string): number {
      const rate = currency === display.currency ? null : r.rate(currency, display.currency, monthFor(on));
      return rate == null || rate <= 0 ? cents : Math.round(cents / rate);
    },
    budget: (cents: number) => latest(cents, budgetCurrency, display.currency),
    charge: (cents: number) => latest(cents, baseCurrency, display.currency),
    chargeBack: (cents: number) => latest(cents, display.currency, baseCurrency),
  };
}
export type Shown = ReturnType<typeof shownFor>;
