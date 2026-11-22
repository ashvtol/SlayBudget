import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ipc } from '@/lib/ipc';
import { shortDate } from '@/lib/format';
import type { ImportRecord } from '@/lib/types';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The files imported so far, newest first, each with Undo import (removes only the rows that file added). */
export function RecentImports({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [imports, setImports] = useState<ImportRecord[] | null>(null);
  const [confirm, setConfirm] = useState<ImportRecord | null>(null);

  const load = useCallback(() => {
    Promise.resolve()
      .then(() => ipc().listImports())
      .then(setImports)
      .catch(() => setImports([]));
  }, []);
  useEffect(load, [load, refreshKey]);

  if (imports == null) return null;
  return (
    <section aria-label="Recent imports" className="flex flex-col gap-2">
      <h2 className="m-0 text-[13px] font-semibold">Recent imports</h2>
      {imports.length === 0 ? (
        <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>Nothing imported yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col rounded-lg border p-0" style={{ borderColor: 'var(--line)' }}>
          {imports.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-[12px]" style={{ borderTop: i ? '1px solid var(--line)' : undefined }}>
              <span className="min-w-0 flex-1 truncate font-semibold">{r.fileName}</span>
              <span style={{ color: 'var(--muted)' }}>{r.sourceName}</span>
              <span className="w-[56px] text-right" style={{ color: 'var(--muted)' }}>{shortDate(r.importedAt.slice(0, 10))}</span>
              <span className="w-[72px] text-right tabular-nums">{r.remaining} added</span>
              <button
                type="button"
                aria-label={`Undo import ${r.fileName}`}
                disabled={r.remaining === 0}
                onClick={() => setConfirm(r)}
                className="h-[24px] rounded-md border px-2 text-[11px] font-semibold disabled:opacity-40"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Undo "${confirm.fileName}"?`}
          body={`Removes the ${plural(confirm.remaining, 'transaction')} it added, with their categories, notes and tags. Rows it skipped as already imported stay. A backup of your data is made first, and you can import the file again.`}
          confirmLabel="Undo import"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const id = confirm.id;
            setConfirm(null);
            void ipc()
              .undoImport(id)
              .then(() => {
                load();
                onChanged?.();
              });
          }}
        />
      )}
    </section>
  );
}
