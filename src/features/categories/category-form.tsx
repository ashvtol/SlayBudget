import { useEffect, useMemo, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { errorMessage, normalizedName } from '@/lib/category-names';
import type { CategoryGroup, GroupTarget } from '@/lib/types';
import { EmojiPicker } from './emoji-picker';
import { PALETTE } from './palette';

/** Copilot-style "New category" form: type, emoji, name, budget, color, plus a group. */
export function CategoryForm({
  groups,
  existingNames,
  onSaved,
  onCancel,
}: {
  groups: CategoryGroup[];
  existingNames: string[];
  onSaved: (id: number) => void;
  onCancel: () => void;
}) {
  const [excluded, setExcluded] = useState(false);
  const [emoji, setEmoji] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [color, setColor] = useState(PALETTE[5]);
  const [group, setGroup] = useState<string>('own');
  const [newGroup, setNewGroup] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const clash = useMemo(() => {
    const wanted = normalizedName(name);
    return wanted ? existingNames.find((n) => normalizedName(n) === wanted) : undefined;
  }, [name, existingNames]);
  const budgetCents = budget.trim() === '' ? null : Math.round(Number(budget.replace(/[$,]/g, '')) * 100);
  const budgetInvalid = budgetCents != null && Number.isNaN(budgetCents);
  const groupMissing = group === 'new' && !normalizedName(newGroup);
  const canSave = normalizedName(name) !== '' && !clash && !budgetInvalid && !groupMissing;

  const save = async () => {
    const target: GroupTarget = group === 'own' ? 'own' : group === 'new' ? { new: newGroup.trim() } : { existing: Number(group) };
    try {
      const id = await ipc().createCategory({ group: name.trim(), name: name.trim(), emoji, color, budgetCents, excluded, groupTarget: target });
      onSaved(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const message = clash ? `A category named ${clash} already exists` : budgetInvalid ? 'Budget must be a number' : error;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div role="dialog" aria-label="New category" className="w-[432px] overflow-hidden rounded-xl border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="flex flex-col items-center gap-4 px-6 pb-5 pt-5">
          <div className="label-caps" style={{ color: 'var(--muted)' }}>New category</div>
          <div role="radiogroup" aria-label="Type" className="flex w-full rounded-md p-0.5" style={{ background: 'var(--bg)' }}>
            {(['Regular', 'Excluded'] as const).map((t) => {
              const on = (t === 'Excluded') === excluded;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setExcluded(t === 'Excluded')} className="h-[24px] flex-1 rounded text-[12px] font-semibold" style={{ background: on ? 'var(--hover)' : 'transparent', color: on ? 'var(--text)' : 'var(--muted)' }}>
                  {t}
                </button>
              );
            })}
          </div>
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <input aria-label="Category name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" className="w-full bg-transparent text-center text-[22px] font-semibold outline-none" style={{ color: 'var(--text)' }} />
          <div className="flex items-baseline gap-1 text-[18px] font-semibold">
            <span style={{ color: 'var(--muted)' }}>$</span>
            <input aria-label="Budget" value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="Budget" className="w-[110px] bg-transparent text-center outline-none" style={{ color: 'var(--text)' }} />
          </div>
          <div className="flex w-full items-center gap-2 text-[12px]">
            <label htmlFor="category-group" style={{ color: 'var(--muted)' }}>Group</label>
            <select id="category-group" aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} className="h-[26px] flex-1 rounded-md border px-2 outline-none" style={{ borderColor: 'var(--line-strong)', background: 'var(--bg)', color: 'var(--text)' }}>
              <option value="own">No group</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
              <option value="new">New group…</option>
            </select>
            {group === 'new' && (
              <input aria-label="New group name" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name" className="h-[26px] flex-1 rounded-md border bg-transparent px-2 outline-none" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }} />
            )}
          </div>
          {message && <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{message}</p>}
        </div>
        <div role="radiogroup" aria-label="Color" className="flex">
          {PALETTE.map((c, i) => (
            <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={`Color ${i + 1}`} onClick={() => setColor(c)} className="flex h-[22px] flex-1 items-center justify-center text-[11px] font-bold" style={{ background: c, color: '#fff' }}>
              {c === color ? '✓' : ''}
            </button>
          ))}
        </div>
        <button type="button" disabled={!canSave} onClick={() => void save()} className="h-[44px] w-full text-[14px] font-bold uppercase tracking-[0.04em] disabled:opacity-50" style={{ background: color, color: '#06101f' }}>
          Save
        </button>
      </div>
    </div>
  );
}
