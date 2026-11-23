import { useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { isTauri } from '@/lib/tauri-ipc';
import { Switch } from '@/components/switch';
import { Button } from '@/components/button';

const KEY_WATCHED = 'watched_folder';

/** Configure a watched folder that auto-imports new statement files dropped in. */
export function ImportSourcesPane() {
  const [folder, setFolder] = useState<string>('');
  const [loaded, setLoaded] = useState(false);
  const [downloads, setDownloads] = useState(false);

  useEffect(() => {
    void ipc().getSetting(KEY_WATCHED).then((v) => {
      setFolder(v ?? '');
      setLoaded(true);
    });
    void ipc().getSetting('watch_downloads').then((v) => setDownloads(v === 'true'));
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

  // Only statements that arrive after you turn this on are imported (older downloads stay out).
  const watchDownloads = async (on: boolean) => {
    setDownloads(on);
    if (on) await ipc().setSetting('watch_downloads_since', String(Date.now()));
    await ipc().setSetting('watch_downloads', on ? 'true' : 'false');
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
          Drop statements into this folder, or into an account's folder inside it (Settings {'>'} Accounts), and SlayBudget imports them, asking once when it can't tell the account. Files already imported are skipped.
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
              <Button variant="primary" onClick={() => void pick()}>
                Choose…
              </Button>
              {folder && (
                <Button variant="destructive" onClick={() => void clear()}>
                  Clear
                </Button>
              )}
            </>
          ) : (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Available in the installed app.</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1.5 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <Switch label="Import statements from my Downloads folder" checked={downloads} onChange={(v) => void watchDownloads(v)} />
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Statements you download from your bank from now on are imported on their own; ones SlayBudget can't place wait
          on the Import page. Anything that isn't a statement is ignored, and files are never moved or changed. macOS
          asks you once to allow access to Downloads.
        </p>
      </div>
    </section>
  );
}
