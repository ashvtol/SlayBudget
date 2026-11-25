import { useEffect, useState } from 'react';
import { Button } from '@/components/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Select } from '@/components/select';
import { Switch } from '@/components/switch';
import { ipc } from '@/lib/ipc';

const DAYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Settings > Categorization: automatic categorizing, the transfer window, and forgetting what was learned. */
export function CategorizationPane() {
  const [auto, setAuto] = useState<boolean | null>(null);
  const [days, setDays] = useState('4');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, d] = await Promise.all([ipc().getSetting('auto_categorize'), ipc().getSetting('transfer_window_days')]);
      setAuto(a !== '0');
      if (d) setDays(d);
    })();
  }, []);

  if (auto == null) return null;
  return (
    <div className="flex flex-col gap-3">
      <Switch
        label="Automatically categorize when confident"
        checked={auto}
        onChange={(v) => {
          setAuto(v);
          void ipc().setSetting('auto_categorize', v ? '1' : '0');
        }}
      />
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        SlayBudget learns from the categories you choose. When it is sure, it sets the category itself and says why;
        otherwise it suggests one for you to check. Turned off, every guess is a suggestion. Nothing leaves your Mac.
      </p>

      <label className="mt-3 flex items-center justify-between gap-3 text-[13px]">
        <span>Transfers between your accounts</span>
        <Select
          aria-label="Transfer days apart"
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            void ipc().setSetting('transfer_window_days', e.target.value);
          }}
        >
          {DAYS.map((d) => (
            <option key={d} value={String(d)}>
              Up to {d} {d === 1 ? 'day' : 'days'} apart
            </option>
          ))}
        </Select>
      </label>
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        Money leaving one of your accounts and the same amount arriving in another within this many days is a transfer,
        not spending or income.
      </p>

      <div className="mt-3">
        <Button onClick={() => setConfirming(true)}>Reset what SlayBudget learned…</Button>
      </div>
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        Forgets the merchants you categorized and what the classifier learned. Your transactions keep their categories.
      </p>
      {done && (
        <p role="status" className="m-0 text-[12px]" style={{ color: 'var(--pos)' }}>
          SlayBudget forgot what it learned.
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Reset what SlayBudget learned?"
          body="It starts again from its list of common merchants. You can undo this from the Edit menu."
          confirmLabel="Reset"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void ipc()
              .resetLearning()
              .then(() => setDone(true));
          }}
        />
      )}
    </div>
  );
}
