import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { isTauri } from '@/lib/tauri-ipc';

const KEY_WATCHED = 'watched_folder';

/** Configure a watched folder that auto-imports new statement files dropped in. */
export function ImportSourcesPane() {
  const [folder, setFolder] = useState<string>('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void ipc().getSetting(KEY_WATCHED).then((v) => {
      setFolder(v ?? '');
      setLoaded(true);
    });
  }, []);

  const pick = async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const chosen = await open({ directory: true, multiple: false, title: 'Choose a folder to watch' });
    if (typeof chosen === 'string') {
      setFolder(chosen);
      await ipc().setSetting(KEY_WATCHED, chosen);
    }
  };

  const clear = async () => {
    setFolder('');
    await ipc().setSetting(KEY_WATCHED, '');
  };

  return (
    <section aria-label="Import sources" className="flex flex-col gap-4 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Watched folder</span>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Drop CSV or PDF statements into this folder and SlayBudget imports them automatically. Files already imported are skipped.
        </p>
      </div>

      {loaded && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={folder}
            placeholder="No folder set"
            aria-label="Watched folder path"
            className="flex-1 rounded-lg border bg-transparent px-2.5 py-2 text-sm"
            style={{ borderColor: 'var(--line)', color: folder ? 'var(--text)' : 'var(--muted)' }}
          />
          {isTauri() ? (
            <>
              <button type="button" onClick={() => void pick()} className="min-h-9 rounded-lg px-3 text-sm font-medium" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
                Choose…
              </button>
              {folder && (
                <button type="button" onClick={() => void clear()} className="min-h-9 rounded-lg px-3 text-sm" style={{ color: 'var(--neg)' }}>
                  Clear
                </button>
              )}
            </>
          ) : (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Available in the installed app.</span>
          )}
        </div>
      )}
    </section>
  );
}
