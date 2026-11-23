import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { Select } from '@/components/select';
import { useCurrencyStore, type FxBasis } from './currency-store';

const BASIS_OPTIONS: { id: FxBasis; label: string; hint: string }[] = [
  { id: 'monthAverage', label: 'Month of each transaction', hint: 'Each amount at the average rate of its own month.' },
  { id: 'latest', label: 'Latest rates', hint: 'Everything at the most recent month’s rate: what it’s worth now.' },
];

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** Settings > Currency: the currency amounts are shown in, converted with rates built into the app (no network). */
export function CurrencyPane() {
  const { displayCurrency, basis, load, setDisplayCurrency, setBasis } = useCurrencyStore();
  const [info, setInfo] = useState<{ currencies: string[]; latestMonth: string } | null>(null);
  const [base, setBase] = useState('USD');

  useEffect(() => {
    void load();
    void ipc().fxInfo().then(setInfo);
    void ipc().getSetting('base_currency').then((b) => setBase(b || 'USD'));
  }, [load]);

  const converts = displayCurrency !== base;

  return (
    <section aria-label="Currency" className="flex flex-col gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="display-currency" className="text-sm font-medium">Display currency</label>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Every amount is shown in this currency. Your data keeps the currency it was imported in, so switching back is
          exact.
        </p>
        <Select id="display-currency" aria-label="Display currency" className="mt-1 w-48" value={displayCurrency} onChange={(e) => void setDisplayCurrency(e.target.value)}>
          {(info?.currencies ?? [displayCurrency]).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
      </div>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={!converts} style={{ opacity: converts ? 1 : 0.5 }}>
        <legend className="mb-1 text-sm font-medium">Conversion</legend>
        {BASIS_OPTIONS.map((o) => (
          <label key={o.id} className="flex items-start gap-2 text-sm">
            <input type="radio" name="fx-basis" checked={basis === o.id} onChange={() => void setBasis(o.id)} className="mt-1" aria-label={`${o.label}: ${o.hint}`} />
            <span>
              <span className="block">{o.label}</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {info && (
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Rates through {monthName(info.latestMonth)}: the European Central Bank's monthly averages, built into SlayBudget
          and refreshed with each update. Nothing goes online to convert.
        </p>
      )}
    </section>
  );
}
