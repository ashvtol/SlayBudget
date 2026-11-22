import { useMemo, useState } from 'react';
import type { Category, FtChoice, FtProposal, FtReport, FtTarget } from '@/lib/types';

const keyOf = (t: FtTarget) => (t.kind === 'existing' ? `e:${t.value}` : `n:${t.value}`);
const fromKey = (k: string): FtTarget => (k.startsWith('e:') ? { kind: 'existing', value: Number(k.slice(2)) } : { kind: 'new', value: k.slice(2) });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Review imported merchant rules before importing: untick or re-target each. */
export function FtImportReview({
  proposals,
  categories,
  onImport,
  onCancel,
}: {
  proposals: FtProposal[];
  categories: Category[];
  onImport: (choices: FtChoice[]) => Promise<FtReport>;
  onCancel: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<FtReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);
  const sortedCategories = useMemo(() => [...categories].sort((a, b) => a.name.localeCompare(b.name)), [categories]);
  const label = (t: FtTarget) => (t.kind === 'existing' ? byId[t.value]?.name ?? 'Unknown' : `New category: ${t.value}`);

  // Grouped by the proposed target, so the list reads like the spec: "Restaurants (120 merchants, ...)".
  const groups = useMemo(() => {
    const map = new Map<string, FtProposal[]>();
    for (const p of proposals) map.set(keyOf(p.target), [...(map.get(keyOf(p.target)) ?? []), p]);
    return [...map.entries()].sort(([a], [b]) => label(fromKey(a)).localeCompare(label(fromKey(b))));
    // label depends on byId only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposals, byId]);

  const chosen = proposals.filter((p) => !skipped.has(p.merchant));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const choices = chosen.map((p) => ({ merchant: p.merchant, target: fromKey(targets[p.merchant] ?? keyOf(p.target)) }));
      setReport(await onImport(choices));
    } catch (e) {
      setError(`Couldn’t import: ${(e as Error).message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section role="region" aria-label="Review imported rules" className="flex flex-col gap-3">
      <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
        Untick anything filed wrong, or pick another category. Only transactions still in Other move. A backup is made first.
      </p>
      <div className="max-h-[50vh] overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--line)' }}>
        {groups.map(([key, items]) => {
          const moves = items.reduce((n, p) => n + p.moves, 0);
          const name = label(fromKey(key));
          return (
            <div key={key} role="group" aria-label={name} className="border-b last:border-b-0" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-baseline justify-between px-3 py-2 text-[13px] font-semibold">
                <span>{name}</span>
                <span className="text-[11px] font-normal" style={{ color: 'var(--muted)' }}>
                  {plural(items.length, 'merchant', 'merchants')}, {plural(moves, 'transaction', 'transactions')}
                </span>
              </div>
              {items.map((p) => {
                const own = keyOf(p.target);
                return (
                  <div key={p.merchant} className="flex min-h-8 items-center gap-2.5 px-3 text-[12px]">
                    <input
                      type="checkbox"
                      aria-label={`Include ${p.merchant}`}
                      checked={!skipped.has(p.merchant)}
                      onChange={() =>
                        setSkipped((s) => {
                          const next = new Set(s);
                          if (next.has(p.merchant)) next.delete(p.merchant);
                          else next.add(p.merchant);
                          return next;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{p.merchant}</span>
                    <span className="w-24 text-right tabular-nums" style={{ color: 'var(--muted)' }}>{plural(p.moves, 'transaction', 'transactions')}</span>
                    <select
                      aria-label={`Category for ${p.merchant}`}
                      value={targets[p.merchant] ?? own}
                      onChange={(e) => setTargets((t) => ({ ...t, [p.merchant]: e.target.value }))}
                      className="w-44 rounded-md border bg-transparent px-1.5 py-1 text-[12px]"
                      style={{ borderColor: 'var(--line)', color: 'var(--text)', background: 'var(--panel)' }}
                    >
                      {p.target.kind === 'new' && <option value={own}>New: {p.target.value}</option>}
                      {sortedCategories.map((c) => (
                        <option key={c.id} value={`e:${c.id}`}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
          {report ? 'Close' : 'Cancel'}
        </button>
        {!report && (
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            onClick={() => void submit()}
            className="rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--bg)' }}
          >
            Import {plural(chosen.length, 'merchant', 'merchants')}
          </button>
        )}
      </div>
      {report && (
        <p role="status" className="m-0 text-xs" style={{ color: 'var(--pos)' }}>
          Learned {plural(report.learned, 'merchant', 'merchants')}, moved {plural(report.moved, 'transaction', 'transactions')}.
          {report.created > 0 && ` Added ${plural(report.created, 'category', 'categories')}.`}
        </p>
      )}
      {error && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{error}</p>}
    </section>
  );
}
