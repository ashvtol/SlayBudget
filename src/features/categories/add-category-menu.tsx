import { useEffect, useRef, useState } from 'react';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconPlus } from '@/components/icons';
import { ipc } from '@/lib/ipc';
import { errorMessage, normalizedName } from '@/lib/category-names';
import type { CategoryGroup } from '@/lib/types';
import { CategoryForm } from './category-form';
import { TEMPLATES } from './templates';

/** The "+" in the Categories header: start from scratch, or add a template in one click. */
export function AddCategoryMenu({
  groups,
  existingNames,
  takenGroupNames = [],
  onCreated,
}: {
  groups: CategoryGroup[];
  existingNames: string[];
  /** Group names in use: a template with one of these names would clash, so it is hidden. */
  takenGroupNames?: string[];
  onCreated: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const taken = new Set([...existingNames, ...takenGroupNames].map(normalizedName));
  const templates = TEMPLATES.filter((t) => !taken.has(normalizedName(t.name)));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const addTemplate = async (t: (typeof TEMPLATES)[number]) => {
    setOpen(false);
    setError(null);
    try {
      const id = await ipc().createCategory({ group: t.name, name: t.name, emoji: t.emoji, color: t.color, groupTarget: 'own' });
      onCreated(id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div ref={ref} className="relative">
      <ToolbarButton icon={IconPlus} aria-label="Add category" active={open} onClick={() => setOpen(!open)} />
      {open && (
        <div role="menu" aria-label="Add category" className="absolute left-0 top-[34px] z-30 max-h-[560px] w-[220px] overflow-y-auto rounded-lg border p-1.5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setForm(true); }} className="flex h-[28px] w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]" style={{ color: 'var(--text)' }}>
            Start from scratch
          </button>
          {templates.map((t) => (
            <button key={t.name} type="button" role="menuitem" onClick={() => void addTemplate(t)} className="flex h-[28px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]" style={{ color: 'var(--text)' }}>
              <span aria-hidden="true" className="text-[14px]">{t.emoji}</span>
              {t.name}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="absolute left-0 top-[34px] z-30 m-0 w-[240px] rounded-md border px-2.5 py-1.5 text-[12px]" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--neg)' }}>
          {error}
        </p>
      )}
      {form && (
        <CategoryForm
          groups={groups}
          existingNames={existingNames}
          onCancel={() => setForm(false)}
          onSaved={(id) => {
            setForm(false);
            onCreated(id);
          }}
        />
      )}
    </div>
  );
}
