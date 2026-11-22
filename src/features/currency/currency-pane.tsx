import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { syncRates } from './rates';
import { todayStr } from '@/features/analytics/analytics-store';
import { COMMON_CURRENCIES, useCurrencyStore, type FxBasis } from './currency-store';

const BASIS_OPTIONS: { id: FxBasis; label: string; hint: string }[] = [
  { id: 'transactionDate', label: 'Transaction date', hint: 'Convert each transaction at the rate on its own date.' },
  { id: 'monthAverage', label: 'Monthly average', hint: 'Use the average rate for the transaction’s month.' },
  { id: 'latest', label: 'Latest rate', hint: 'Convert everything at today’s rate.' },
];

const STATEMENT_CURRENCY = 'USD'; // the currency most statements arrive in

export function CurrencyPane() {
  const { displayCurrency, basis, load, setDisplayCurrency, setBasis } = useCurrencyStore();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const converts = displayCurrency !== STATEMENT_CURRENCY;

  const sync = async () => {
    setBusy(true);
    setStatus(null);
    try {
      // The person's own calendar days (toISOString would give UTC's, a day ahead in the evening).
      const to = new Date();
      const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
      const n = await syncRates(STATEMENT_CURRENCY, displayCurrency, todayStr(from), todayStr(to));
      const latest = await ipc().fxLatest(STATEMENT_CURRENCY, displayCurrency);
      setStatus(n > 0 ? `Updated ${n} daily rates. 1 ${STATEMENT_CURRENCY} ≈ ${latest?.toFixed(2)} ${displayCurrency}.` : 'No rates returned.');
    } catch (e) {
      setStatus(`Couldn’t fetch rates: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Currency" className="flex flex-col gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="display-currency" className="text-sm font-medium">Display currency</label>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Show all amounts converted to this currency.</p>
        <select
          id="display-currency"
          value={displayCurrency}
          onChange={(e) => void setDisplayCurrency(e.target.value)}
          className="mt-1 w-48 rounded-lg border bg-transparent px-2.5 py-2 text-sm"
          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
        >
          {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!converts} style={{ opacity: converts ? 1 : 0.5 }}>
        <legend className="mb-1 text-sm font-medium">Conversion basis</legend>
        {BASIS_OPTIONS.map((o) => (
          <label key={o.id} className="flex items-start gap-2.5 text-sm">
            <input type="radio" name="fx-basis" checked={basis === o.id} onChange={() => void setBasis(o.id)} className="mt-1" />
            <span className="flex flex-col">
              <span>{o.label}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void sync()}
          disabled={!converts || busy}
          className="min-h-9 rounded-lg px-3 text-sm font-medium"
          style={{ background: converts && !busy ? 'var(--accent)' : 'var(--line)', color: converts && !busy ? 'var(--on-accent)' : 'var(--muted)' }}
        >
          {busy ? 'Fetching…' : 'Update rates'}
        </button>
        {status && <span className="text-xs" style={{ color: 'var(--muted)' }}>{status}</span>}
        {!converts && <span className="text-xs" style={{ color: 'var(--muted)' }}>Matches your statement currency. No conversion needed.</span>}
      </div>
    </section>
  );
}
