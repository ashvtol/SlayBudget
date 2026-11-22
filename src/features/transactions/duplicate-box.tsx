import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { IconTrash } from '@/components/icons';
import { ipc } from '@/lib/ipc';
import { formatSignedMoney, shortDate } from '@/lib/format';
import { DUPLICATE_TAG_COLOR } from '@/lib/duplicates-memory';
import type { DuplicateFlag, Transaction } from '@/lib/types';
import { displayMerchant } from './transaction-row';
import { useTransactionsStore } from './transactions-store';

type Ask = 'this' | 'other' | null;

/** "Possible duplicate": why this row was flagged on import, the transaction it looks like, and the three ways out. */
export function DuplicateBox({ tx, onOpen }: { tx: Transaction; onOpen?: (id: number) => void }) {
  const [flag, setFlag] = useState<DuplicateFlag | null>(null);
  const [other, setOther] = useState<Transaction | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const sourcesById = useTransactionsStore((s) => s.sourcesById);
  const resolve = useTransactionsStore((s) => s.resolveDuplicate);
  const tagKey = (tx.tagIds ?? []).join(',');

  useEffect(() => {
    let live = true;
    void (async () => {
      const f = await ipc().duplicateFlagFor(tx.id);
      const otherId = f ? (f.txId === tx.id ? f.otherId : f.txId) : null;
      const o = otherId != null ? (await ipc().listTransactions({})).find((t) => t.id === otherId) ?? null : null;
      if (!live) return;
      setFlag(f);
      setOther(o);
    })();
    return () => {
      live = false;
    };
  }, [tx.id, tagKey]);

  if (!flag) return null;
  const isNew = flag.txId === tx.id;
  const settle = (which: 'this' | 'other' | 'keep') => {
    setAsk(null);
    setFlag(null);
    const resolution = which === 'keep' ? 'kept' : (which === 'this') === isNew ? 'deleted' : 'other_deleted';
    void resolve(flag.id, resolution);
  };
  const button = 'flex h-[26px] items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold';

  return (
    <section
      aria-label="Possible duplicate"
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: `color-mix(in srgb, ${DUPLICATE_TAG_COLOR} 45%, transparent)`, background: `color-mix(in srgb, ${DUPLICATE_TAG_COLOR} 7%, transparent)` }}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: DUPLICATE_TAG_COLOR }}>
        <span className="h-2 w-2 rounded-full" style={{ background: DUPLICATE_TAG_COLOR }} />
        Possible duplicate
        <span className="font-normal" style={{ color: 'var(--muted)' }}>· {flag.confidence === 'certain' ? 'very likely' : 'maybe'}</span>
      </div>
      <p className="m-0 text-[12px]">{flag.reason}</p>
      {other && (
        <button
          type="button"
          aria-label={`Open the other transaction: ${displayMerchant(other)}`}
          onClick={() => onOpen?.(other.id)}
          className="flex items-center gap-3 rounded-md border px-3 py-2 text-left text-[12px] hover:bg-[var(--hover)]"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
        >
          <span className="w-[44px] shrink-0" style={{ color: 'var(--muted)' }}>{shortDate(other.postedOn)}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{displayMerchant(other)}</span>
          <span style={{ color: 'var(--muted)' }}>{sourcesById[other.sourceId]?.name}</span>
          <span className="tabular-nums">{formatSignedMoney(other.amountCents, other.currency)}</span>
        </button>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAsk('this')} className={button} style={{ borderColor: 'var(--line-strong)', color: 'var(--neg)' }}>
          <IconTrash size={13} />
          Delete this one
        </button>
        {flag.txId != null && flag.otherId != null && (
          <button type="button" onClick={() => setAsk('other')} className={button} style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
            Delete the other one
          </button>
        )}
        <button type="button" onClick={() => settle('keep')} className={button} style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
          Not a duplicate
        </button>
      </div>
      {ask && (
        <ConfirmDialog
          title={ask === 'this' ? 'Delete this transaction?' : 'Delete the other transaction?'}
          body={`${ask === 'this' ? 'This one' : 'The other one'} goes, with its category, notes and tags. A backup of your data is made first.`}
          confirmLabel="Delete"
          onCancel={() => setAsk(null)}
          onConfirm={() => settle(ask)}
        />
      )}
    </section>
  );
}
