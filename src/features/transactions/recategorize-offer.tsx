import { useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { cleanMerchant } from '@/lib/merchant';
import { MIN_CONTAINS, isPaymentPlatform, normalizeDescription } from '@/lib/recategorize';
import type { Category, RecatMatch, RecatTarget } from '@/lib/types';
import { Switch } from '@/components/switch';
import { MatchList } from './match-list';

type Choice = 'one' | 'merchant' | 'contains';

export interface RecategorizeOfferProps {
  /** Merchant key of the changed transaction (or of a Clean up Other group). */
  merchant: string;
  categoryId: number;
  categoriesById: Record<number, Category>;
  /** Called with how many transactions moved, or null when nothing changed. */
  onDone: (moved: number | null) => void;
  /** Clean up Other: list only rows still in Other (or uncategorized). */
  onlyOther?: boolean;
  /** Other names changed together (several transactions at once): "All named" covers them all. */
  others?: string[];
}

/** "Apply to other transactions?" after a category change: choose a match, see the rows, apply. */
export function RecategorizeOffer({ merchant, categoryId, categoriesById, onDone, onlyOther = false, others = [] }: RecategorizeOfferProps) {
  const category = categoriesById[categoryId];
  const names = useMemo(() => [merchant, ...others.filter((o) => o !== merchant)], [merchant, others]);
  const platform = names.some(isPaymentPlatform);
  const [choice, setChoice] = useState<Choice>('merchant');
  const [text, setText] = useState(merchant);
  const [exact, setExact] = useState<RecatMatch[] | null>(null);
  const [contains, setContains] = useState<RecatMatch[]>([]);
  /** Your ticks and unticks; anything else starts as `startsTicked` says. */
  const [picked, setPicked] = useState<Map<number, boolean>>(new Map());
  // A payment app's rows each can be for something different: no rule for the future unless you ask.
  const [future, setFuture] = useState(!platform);
  const [busy, setBusy] = useState(false);
  const key = names.join('\n');

  useEffect(() => {
    let live = true;
    void Promise.all(names.map((value) => ipc().previewRecategorize({ kind: 'merchant', value }, categoryId))).then((lists) => {
      if (!live) return;
      const seen = new Set<number>();
      const m = lists.flat().filter((x) => !seen.has(x.transaction.id) && seen.add(x.transaction.id));
      // Several names: newest first across them all (each list already is).
      if (lists.length > 1) m.sort((a, b) => b.transaction.postedOn.localeCompare(a.transaction.postedOn) || b.transaction.id - a.transaction.id);
      if (m.length === 0) onDone(null);
      else setExact(m);
    });
    return () => {
      live = false;
    };
    // onDone is a callback from the parent; re-running on its identity would refetch. `key` stands for `names`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, categoryId]);

  useEffect(() => {
    if (choice !== 'contains') return;
    let live = true;
    const target: RecatTarget = { kind: 'contains', value: text };
    void ipc()
      .previewRecategorize(target, categoryId)
      .then((m) => live && setContains(m));
    return () => {
      live = false;
    };
  }, [choice, text, categoryId]);

  const inScope = useMemo(
    () => (rows: RecatMatch[]) => (onlyOther ? rows.filter((m) => m.transaction.categoryId == null || categoriesById[m.transaction.categoryId]?.isOther) : rows),
    [onlyOther, categoriesById],
  );
  const named = useMemo(() => inScope(exact ?? []), [inScope, exact]);
  const shown = useMemo(() => (choice === 'merchant' ? named : choice === 'contains' ? inScope(contains) : []), [choice, named, contains, inScope]);
  // Clean up Other: nothing has moved yet, so "just this one" moves this name's rows that are in Other.
  const own = onlyOther ? named.filter((m) => !m.similar && !m.locked) : [];
  // Similar names, categories you chose yourself, and payment-app rows stay unticked unless you tick them.
  const startsTicked = (m: RecatMatch) => !m.similar && m.transaction.categorySource !== 'user' && !isPaymentPlatform(m.transaction.merchant);
  const isTicked = (m: RecatMatch) => !m.locked && (picked.get(m.transaction.id) ?? startsTicked(m));
  const ticked = shown.filter(isTicked);
  const title = `Apply “${category?.name ?? 'this category'}” to other transactions?`;
  const quoted = names.map((n) => `“${cleanMerchant(n)}”`);
  const name = quoted.length <= 2 ? quoted.join(' and ') : `${quoted.slice(0, 2).join(', ')} and ${quoted.length - 2} more`;

  async function apply() {
    setBusy(true);
    try {
      const moved = await ipc().applyRecategorize(ticked.map((m) => m.transaction.id), categoryId);
      if (future && choice === 'merchant') {
        for (const pattern of names) await ipc().saveRule({ kind: 'merchant', pattern, categoryId });
      } else if (future && choice === 'contains') {
        await ipc().saveRule({ kind: 'contains', pattern: normalizeDescription(text), categoryId });
      }
      onDone(moved);
    } finally {
      setBusy(false);
    }
  }

  async function applyOwn() {
    setBusy(true);
    try {
      onDone(await ipc().applyRecategorize(own.map((m) => m.transaction.id), categoryId));
    } finally {
      setBusy(false);
    }
  }

  const shell = (body: React.ReactNode) => (
    <section
      role="region"
      aria-label={title}
      className="rounded-xl border p-4 text-[13px]"
      style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }}
    >
      <h3 className="m-0 mb-3 text-[14px] font-semibold">{title}</h3>
      {body}
    </section>
  );

  if (exact == null) return null;

  const option = (value: Choice, label: React.ReactNode, count?: number) => (
    <label className="flex min-h-8 items-center gap-2.5">
      <input type="radio" name="recat-choice" checked={choice === value} onChange={() => setChoice(value)} aria-label={typeof label === 'string' ? label : undefined} />
      <span className="flex-1">{label}</span>
      {count != null && <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{count}</span>}
    </label>
  );

  return shell(
    <>
      <div className="flex flex-col">
        {option('one', own.length > 1 ? `Just these ${own.length}` : 'Just this one')}
        {option('merchant', `All named ${name}`, named.length)}
        <label className="flex min-h-8 items-center gap-2.5">
          <input type="radio" name="recat-choice" checked={choice === 'contains'} onChange={() => setChoice('contains')} aria-label="Names containing" />
          <span>Names containing</span>
          <input
            value={text}
            onFocus={() => setChoice('contains')}
            onChange={(e) => setText(e.target.value)}
            aria-label="Name contains"
            className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 text-[12px]"
            style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
          />
          {choice === 'contains' && <span className="tabular-nums" style={{ color: 'var(--muted)' }}>{shown.length}</span>}
        </label>
        {choice === 'contains' && normalizeDescription(text).length < MIN_CONTAINS && (
          <p className="m-0 pl-6 text-[12px]" style={{ color: 'var(--muted)' }}>Type at least {MIN_CONTAINS} characters.</p>
        )}
      </div>

      {choice !== 'one' && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
          <MatchList
            rows={shown}
            startOpen
            ticked={new Set(shown.filter(isTicked).map((m) => m.transaction.id))}
            onChange={(next) =>
              setPicked((p) => {
                const out = new Map(p);
                for (const m of shown) out.set(m.transaction.id, next.has(m.transaction.id));
                return out;
              })
            }
            categoriesById={categoriesById}
          />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
        {choice !== 'one' ? <Switch label="Also file future transactions this way" checked={future} onChange={setFuture} /> : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={() => onDone(null)} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
            Not now
          </button>
          {choice === 'one' ? (
            <button
              type="button"
              disabled={busy || (onlyOther && own.length === 0)}
              onClick={() => (onlyOther ? void applyOwn() : onDone(null))}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || ticked.length === 0}
              onClick={() => void apply()}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--bg)' }}
            >
              Apply to {ticked.length}
            </button>
          )}
        </div>
      </div>
    </>,
  );
}
