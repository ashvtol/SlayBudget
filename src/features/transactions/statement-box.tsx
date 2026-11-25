import { useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { statementClues } from '@/lib/statement-clues';
import type { StatementInfo, Transaction } from '@/lib/types';

/** A transaction as its statement shows it: the line, what the bank said about it, and where it was imported from.
 *  The detail pane's Statement section, and the ⓘ details in lists of transactions to choose from. */
export function StatementBox({ tx, named = false, onClose }: { tx: Transaction; named?: boolean; /** Details opened from an ⓘ: a quiet × closes them. */ onClose?: () => void }) {
  const [info, setInfo] = useState<StatementInfo | null>(null);
  useEffect(() => {
    let live = true;
    void ipc()
      .statementInfo(tx.id)
      .then((i) => live && setInfo(i))
      .catch(() => live && setInfo(null));
    return () => {
      live = false;
    };
  }, [tx.id]);
  const clues = useMemo(() => statementClues(tx.description), [tx.description]);
  const fields = info?.fields ?? [];
  const imported = info?.importedAt ? new Date(info.importedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  return (
    <div
      role={named ? 'group' : undefined}
      aria-label={named ? `Statement for ${tx.description}` : undefined}
      className={`relative rounded-md border px-3 py-2.5 ${onClose ? 'pr-9' : ''}`.trim()}
      style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
    >
      {onClose && (
        <button
          type="button"
          aria-label="Close statement details"
          title="Close"
          onClick={onClose}
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md hover:bg-[color-mix(in_srgb,var(--text)_8%,transparent)]"
          style={{ color: 'var(--subtle)' }}
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      )}
      <div className="text-[11px]" style={{ color: 'var(--subtle)' }}>Appears on statement as</div>
      <div className="mt-0.5 select-text whitespace-pre-wrap break-words font-mono text-[12px]" style={{ color: 'var(--text)' }}>{tx.description}</div>
      {(clues.length > 0 || fields.length > 0) && (
        <dl className="m-0 mt-2.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {[...clues.map((c) => [c.label, c.value] as const), ...fields].map(([label, value], i) => (
            <div key={`${label}-${i}`} data-row className="contents">
              <dt style={{ color: 'var(--muted)' }}>{label}</dt>
              <dd className="m-0 select-text whitespace-pre-wrap break-words" style={{ color: 'var(--text)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {info?.fileName && (
        <div className="mt-2.5 text-[11px]" style={{ color: 'var(--subtle)' }}>
          Imported from {info.fileName} ({info.sourceName}){imported ? `, ${imported}` : ''}
        </div>
      )}
    </div>
  );
}

/** An ⓘ that opens and closes statement details. */
export function InfoButton({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      title="Statement details"
      onClick={onToggle}
      className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
      style={{ color: open ? 'var(--accent)' : 'var(--muted)', border: '1px solid currentColor' }}
    >
      i
    </button>
  );
}

/** The ⓘ at the end of a row: opens and closes that transaction's statement details. */
export function DetailsButton({ tx, open, onToggle }: { tx: Transaction; open: boolean; onToggle: () => void }) {
  return <InfoButton label={`Statement details for ${tx.description} on ${tx.postedOn}`} open={open} onToggle={onToggle} />;
}

/** Which rows have their details open. */
export function useOpenRows() {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { isOpen: (id: number) => open.has(id), toggle };
}
