import { useState } from 'react';
import { isTauri } from '@/lib/tauri-ipc';

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'uptodate' } | { kind: 'available'; version: string } | { kind: 'error'; message: string } | { kind: 'unsupported' };

export function UpdatesPane() {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [installing, setInstalling] = useState(false);

  const check = async () => {
    if (!isTauri()) {
      setStatus({ kind: 'unsupported' });
      return;
    }
    setStatus({ kind: 'checking' });
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater');
      const update = await checkUpdate();
      if (update) setStatus({ kind: 'available', version: update.version });
      else setStatus({ kind: 'uptodate' });
    } catch (e) {
      // Updater not configured (no signing key / endpoint) or offline.
      setStatus({ kind: 'error', message: (e as Error).message });
    }
  };

  const installNow = async () => {
    setInstalling(true);
    try {
      const { check: checkUpdate } = await import('@tauri-apps/plugin-updater');
      const update = await checkUpdate();
      if (update) {
        await update.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      }
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section aria-label="Updates" className="flex flex-col gap-4 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Software updates</span>
        <button
          type="button"
          onClick={() => void check()}
          disabled={status.kind === 'checking'}
          className="min-h-9 rounded-lg px-3 text-sm font-medium"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {status.kind === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      {status.kind === 'uptodate' && <p className="m-0 text-sm" style={{ color: 'var(--pos)' }}>You’re on the latest version.</p>}
      {status.kind === 'available' && (
        <div className="flex items-center justify-between">
          <span className="text-sm">Version {status.version} is available.</span>
          <button
            type="button"
            onClick={() => void installNow()}
            disabled={installing}
            className="min-h-9 rounded-lg px-3 text-sm font-medium"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            {installing ? 'Installing…' : 'Install and restart'}
          </button>
        </div>
      )}
      {status.kind === 'unsupported' && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>Updates are available in the installed desktop app.</p>}
      {status.kind === 'error' && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>Couldn’t check right now: {status.message}</p>}
      <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Updates are downloaded from GitHub Releases and verified before installing.</p>
    </section>
  );
}
