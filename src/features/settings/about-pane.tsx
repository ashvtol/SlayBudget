import { useEffect, useState } from 'react';
import { isTauri } from '@/lib/tauri-ipc';

const FALLBACK_VERSION = '0.1.0';

export function AboutPane() {
  const [version, setVersion] = useState(FALLBACK_VERSION);

  useEffect(() => {
    if (!isTauri()) return;
    void import('@tauri-apps/api/app').then((m) => m.getVersion()).then(setVersion).catch(() => {});
  }, []);

  return (
    <section aria-label="About" className="flex flex-col gap-3 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-xl font-semibold">SlayBudget</span>
        <span className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>v{version}</span>
      </div>
      <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>
        A fast, local-first budgeting app for macOS. Your financial data stays on your Mac in a single
        database file. No accounts, no subscription, no cloud.
      </p>
      <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Built with Tauri, React and Rust.</p>
    </section>
  );
}
