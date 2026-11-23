import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { Select } from '@/components/select';
import { Button } from '@/components/button';

const KEY_PLAID_CLIENT = 'plaid_client_id';
const KEY_PLAID_ENV = 'plaid_env';

/**
 * Bank connections via Plaid. The Link flow and token exchange need a Plaid
 * client ID + secret and a decision on where the secret lives (see
 * slaybudget-decisions-and-bank-sync in the project). Until that's configured
 * this pane captures the client ID and explains what's left.
 */
export function BankConnectionsPane() {
  const [clientId, setClientId] = useState('');
  const [env, setEnv] = useState('sandbox');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void Promise.all([ipc().getSetting(KEY_PLAID_CLIENT), ipc().getSetting(KEY_PLAID_ENV)]).then(([c, e]) => {
      setClientId(c ?? '');
      setEnv(e ?? 'sandbox');
      setLoaded(true);
    });
  }, []);

  const configured = clientId.trim() !== '';

  return (
    <section aria-label="Bank connections" className="flex flex-col gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Connect a bank (Plaid)</span>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Securely link Citi, Amex, Capital One and most US banks to import transactions automatically.
          Plaid’s free plan covers up to 10 linked banks.
        </p>
      </div>

      {loaded && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Plaid client ID</span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              onBlur={() => void ipc().setSetting(KEY_PLAID_CLIENT, clientId.trim())}
              placeholder="From dashboard.plaid.com"
              aria-label="Plaid client ID"
              className="rounded-lg border bg-transparent px-2.5 py-2 text-sm"
              style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Environment</span>
            <Select className="w-40" value={env} onChange={(e) => { setEnv(e.target.value); void ipc().setSetting(KEY_PLAID_ENV, e.target.value); }} aria-label="Plaid environment">
              <option value="sandbox">Sandbox</option>
              <option value="production">Production</option>
            </Select>
          </label>

          <Button disabled title="Needs the one-time Plaid setup below" className="w-fit">
            Connect a bank
          </Button>

          <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
            {configured
              ? 'Client ID saved. One step remains: the Plaid secret must be handled securely (it can’t live in the app’s frontend). See the bank-sync plan in your project for the two options — a tiny token-exchange helper vs. embedding it in the Rust core — before linking a real bank.'
              : 'Create a free Plaid account, paste the client ID above, then follow the bank-sync plan in your project to finish setup.'}
          </p>
        </>
      )}
    </section>
  );
}
