import { useState } from 'react';
import { errorMessage } from '@/lib/category-names';

/** A heading you click to rename: Enter saves, Escape cancels, errors keep you editing. */
export function EditableTitle({ value, label = 'Category name', onSave }: { value: string; label?: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return (
      <h2 className="m-0 text-[24px] font-semibold">
        <button type="button" aria-label={`Rename ${value}`} onClick={() => { setDraft(value); setError(null); setEditing(true); }} className="rounded text-left hover:opacity-80">
          {value}
        </button>
      </h2>
    );
  }
  const save = async () => {
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div>
      <input
        aria-label={label}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className="w-full rounded-md border bg-transparent px-1 text-[24px] font-semibold outline-none"
        style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
      />
      {error && <p role="alert" className="m-0 mt-1 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>}
    </div>
  );
}
