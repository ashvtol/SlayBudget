import { useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri-ipc';
import { useNotificationsStore } from './notifications-store';
import { isAutostartEnabled, setAutostart } from './notify';

const HORIZONS = [3, 7, 14];

export function NotificationsPane() {
  const { enabled, horizonDays, load, setEnabled, setHorizon } = useNotificationsStore();
  const [autostart, setAuto] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    void load();
    void isAutostartEnabled().then(setAuto);
  }, [load]);

  const toggleAutostart = async (v: boolean) => {
    setAuto(v);
    await setAutostart(v);
  };

  return (
    <section aria-label="Notifications" className="flex flex-col gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <label className="flex items-center justify-between gap-4">
        <span className="flex flex-col">
          <span className="text-sm font-medium">Reminders &amp; alerts</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Notify me about upcoming bills and budgets going over.</span>
        </span>
        <input type="checkbox" role="switch" aria-label="Enable notifications" checked={enabled} onChange={(e) => void setEnabled(e.target.checked)} />
      </label>

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0" disabled={!enabled} style={{ opacity: enabled ? 1 : 0.5 }}>
        <legend className="mb-1 text-sm font-medium">Remind me this far ahead</legend>
        <div role="radiogroup" aria-label="Reminder horizon" className="inline-flex rounded-lg border p-0.5" style={{ borderColor: 'var(--line)', width: 'fit-content' }}>
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              role="radio"
              aria-checked={horizonDays === h}
              onClick={() => void setHorizon(h)}
              className="min-h-7 rounded-md px-3 text-xs font-medium"
              style={{ background: horizonDays === h ? 'var(--accent)' : 'transparent', color: horizonDays === h ? 'var(--on-accent)' : 'var(--muted)' }}
            >
              {h} days
            </button>
          ))}
        </div>
      </fieldset>

      {desktop && (
        <label className="flex items-center justify-between gap-4" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
          <span className="flex flex-col">
            <span className="text-sm font-medium">Launch at login</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Open SlayBudget automatically when you sign in.</span>
          </span>
          <input type="checkbox" role="switch" aria-label="Launch at login" checked={autostart} onChange={(e) => void toggleAutostart(e.target.checked)} />
        </label>
      )}

      {!desktop && <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Desktop notifications and launch-at-login are available in the installed app.</p>}
    </section>
  );
}
