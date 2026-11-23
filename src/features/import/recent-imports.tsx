import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ipc } from '@/lib/ipc';
import { shortDate } from '@/lib/format';
import type { ImportRecord, Source } from '@/lib/types';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The files imported so far, newest first, each with Undo import (removes only the rows that file added). */
export function RecentImports({ refreshKey = 0, onChanged }: { refreshKey?: number; onChanged?: () => void }) {
  const [imports, setImports] = useState<ImportRecord[] | null>(null);
  const [confirm, setConfirm] = useState<ImportRecord | null>(null);
  const [moving, setMoving] = useState<ImportRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
                aria-label={`Move ${r.fileName} to another account`}
                title="Move to another account"
                disabled={r.remaining === 0}
                onClick={() => setMoving(r)}
                className="h-[24px] rounded-md border px-2 text-[11px] font-semibold disabled:opacity-40"
                style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
              >
                Move…
              </button>
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
      {message && (
        <p role="status" className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
          {message}
        </p>
      )}
      {moving && (
        <MoveDialog
          record={moving}
          onCancel={() => setMoving(null)}
          onMoved={(text) => {
            setMoving(null);
            setMessage(text);
            load();
            onChanged?.();
          }}
        />
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

const count = (n: number) => `${n} ${n === 1 ? 'transaction' : 'transactions'}`;

/** "Move nov.csv": pick the account it really belongs to; rows that account already has are dropped. */
function MoveDialog({ record, onCancel, onMoved }: { record: ImportRecord; onCancel: () => void; onMoved: (message: string) => void }) {
  const [accounts, setAccounts] = useState<Source[]>([]);
  const [target, setTarget] = useState<number | null>(null);
  useEffect(() => {
    void ipc()
      .listSources()
      .then((all) => {
        const profile = all.find((a) => a.id === record.sourceId)?.profileId;
        const others = all.filter((a) => a.id !== record.sourceId && (profile == null || a.profileId === profile));
        setAccounts(others);
        setTarget(others[0]?.id ?? null);
      });
  }, [record]);
  const move = async () => {
    if (target == null) return;
    const name = accounts.find((a) => a.id === target)?.name ?? 'the account';
    const { moved, dropped } = await ipc().moveImport(record.id, target);
    onMoved(`Moved ${count(moved)} to ${name}${dropped ? `; ${dropped} ${dropped === 1 ? 'was' : 'were'} already there.` : '.'}`);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div role="dialog" aria-label={`Move "${record.fileName}"`} className="w-[380px] rounded-lg border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
          <div className="text-[13px] font-semibold">Move “{record.fileName}”</div>
          <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
            Its {count(record.remaining)} move to the account you choose. Any that account already has are removed as
            duplicates. You can undo this.
          </p>
          <select
            aria-label="Account"
            value={target ?? ''}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="h-[28px] rounded-md border bg-transparent px-2 text-[12px]"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <button type="button" onClick={onCancel} className="h-[28px] rounded-md border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)', background: 'var(--bg)' }}>
            Cancel
          </button>
          <button type="button" disabled={target == null} onClick={() => void move()} className="h-[28px] rounded-md px-3 text-[12px] font-semibold disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
