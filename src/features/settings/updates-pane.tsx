import { useEffect } from 'react';
import { useUpdateStore } from '@/features/updates/update-store';
import { ChangelogView } from '@/features/updates/update-ui';

const time = (d: Date) => d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Settings > Updates: installed version, last check, Check now, and what's new in a waiting update. */
export function UpdatesPane() {
  const { status, currentVersion, available, sections, lastChecked, error, checkNow, openDialog } = useUpdateStore();
  useEffect(() => {
    // Show the installed version even before the first check.
    if (useUpdateStore.getState().currentVersion == null && status === 'idle') void checkNow({ auto: true });
  }, [status, checkNow]);

  return (
    <section aria-label="Updates" className="flex flex-col gap-4 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Software updates</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            {currentVersion ? `Installed version ${currentVersion}` : status === 'unsupported' ? 'Browser preview' : 'Installed version …'}
            {lastChecked && ` · Last checked ${time(lastChecked)}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void checkNow({ auto: false })}
          disabled={status === 'checking' || status === 'installing'}
          className="min-h-9 rounded-lg px-3 text-sm font-medium disabled:opacity-60"
          style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
        >
          {status === 'checking' ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {status === 'uptodate' && <p className="m-0 text-sm" style={{ color: 'var(--pos)' }}>You’re on the latest version.</p>}
      {(status === 'available' || status === 'installing') && available && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Version {available.version} is available</span>
            <button type="button" onClick={openDialog} className="min-h-8 rounded-lg border px-3 text-sm font-medium" style={{ borderColor: 'var(--line-strong)', color: 'var(--accent)' }}>
              Install…
            </button>
          </div>
          <ChangelogView sections={sections} fallback={available.notes} />
        </div>
      )}
      {status === 'unsupported' && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>Updates are available in the installed desktop app.</p>}
      {status === 'error' && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>Couldn’t check: {error}</p>}
      <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
        SlayBudget checks for updates when it opens and every 6 hours, and always asks before installing. Updates come
        from GitHub Releases and are verified before they install.
      </p>
    </section>
  );
}
