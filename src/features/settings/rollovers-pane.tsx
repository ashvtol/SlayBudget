import { useEffect, useState } from 'react';
import { Switch } from '@/components/switch';
import { ipc } from '@/lib/ipc';

export const ROLLOVERS_KEY = 'budgets.rollovers';

/** Settings > Rollovers (Copilot): carry leftover budget into the next month. */
export function RolloversPane() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void ipc()
      .getSetting(ROLLOVERS_KEY)
      .then((v) => live && setOn(v === '1'));
    return () => {
      live = false;
    };
  }, []);
  const change = async (next: boolean) => {
    setOn(next);
    await ipc().setSetting(ROLLOVERS_KEY, next ? '1' : '0');
  };
  return (
    <div className="flex flex-col gap-3">
      <Switch label="Enable rollover" checked={on ?? false} onChange={(v) => void change(v)} />
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        With rollover, what a category doesn't spend in a month carries into the next month, and overspending comes out of it. Choose which
        categories roll over when you edit their budget.
      </p>
    </div>
  );
}
