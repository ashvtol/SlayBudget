import { useEffect, useRef, useState } from 'react';
import { IconPlus } from '@/components/icons';
import { TAG_PALETTE } from '@/lib/ipc';
import { useTagsStore } from '@/lib/stores/tags-store';
import type { Tag } from '@/lib/types';
import { Button } from '@/components/button';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Settings > Tags (Copilot): New tag, then one row per tag with a color dot and an editable name. */
export function TagsPane() {
  const tags = useTagsStore((s) => s.tags);
  const load = useTagsStore((s) => s.load);
  const create = useTagsStore((s) => s.create);
  const remove = useTagsStore((s) => s.remove);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<Tag | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const addTag = async () => {
    try {
      const id = await create(useTagsStore.getState().nextNewName());
      setFocusId(id);
      setError(null);
    } catch (e) {
      setError(message(e));
    }
  };
  const askDelete = (tag: Tag) => {
    if (tag.count === 0) void remove(tag.id);
    else setConfirm(tag);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>
          Use tags to categorize your transactions more granularly. These can be used across regular, income, and internal transactions.
        </p>
        <Button onClick={() => void addTag()} className="shrink-0">
          <IconPlus size={12} />
          New tag
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>
      )}
      <div className="flex flex-col gap-2">
        {tags.map((t) => (
          // Keyed by name too: a saved rename starts the row afresh with the new name.
          <TagRow key={`${t.id}:${t.name}`} tag={t} autoFocus={t.id === focusId} onFocused={() => setFocusId(null)} onError={setError} onDelete={() => askDelete(t)} />
        ))}
      </div>
      {confirm && (
        <ConfirmDelete
          tag={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void remove(confirm.id);
          }}
        />
      )}
    </div>
  );
}

function TagRow({ tag, autoFocus, onFocused, onError, onDelete }: { tag: Tag; autoFocus: boolean; onFocused: () => void; onError: (e: string | null) => void; onDelete: () => void }) {
  const update = useTagsStore((s) => s.update);
  const [name, setName] = useState(tag.name);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    field.current?.focus();
    field.current?.select();
    // Only once: a rename remounts the row, and it must not take focus back.
    onFocused();
  }, [autoFocus, onFocused]);

  const save = async () => {
    if (name.trim() === tag.name) {
      setName(tag.name);
      return;
    }
    try {
      await update(tag.id, { name });
      onError(null);
    } catch (e) {
      setName(tag.name);
      onError(message(e));
    }
  };

  return (
    <div className="group relative flex h-[40px] items-center rounded-md border" style={{ borderColor: 'var(--line-strong)' }}>
      <button
        type="button"
        aria-label={`Color for ${tag.name}`}
        aria-expanded={paletteOpen}
        onClick={() => setPaletteOpen(!paletteOpen)}
        className="flex h-full w-[36px] shrink-0 items-center justify-center border-r"
        style={{ borderColor: 'var(--line)' }}
      >
        <span className="h-[8px] w-[8px] rounded-full" style={{ background: tag.color }} />
      </button>
      <input
        ref={field}
        value={name}
        aria-label={`Tag name ${tag.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setName(tag.name);
            e.currentTarget.blur();
          }
        }}
        className="field-bare h-full min-w-0 flex-1 bg-transparent px-3 text-[13px] outline-none"
        style={{ color: 'var(--text)' }}
      />
      <button
        type="button"
        aria-label={`Delete ${tag.name}`}
        onClick={onDelete}
        className="mr-2 rounded px-1.5 text-[15px] leading-none opacity-0 focus:opacity-100 group-hover:opacity-100"
        style={{ color: 'var(--muted)' }}
      >
        ×
      </button>
      {paletteOpen && (
        <Palette
          current={tag.color}
          onPick={(color) => {
            setPaletteOpen(false);
            void update(tag.id, { color });
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/** Copilot's color popover: two rows of swatches. */
function Palette({ current, onPick, onClose }: { current: string; onPick: (color: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Colors"
      className="absolute left-0 top-[44px] z-30 grid grid-cols-7 gap-2 rounded-lg border p-2.5 shadow-2xl"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      {TAG_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="option"
          aria-selected={c === current}
          aria-label={c}
          onClick={() => onPick(c)}
          className="h-[22px] w-[22px] rounded-full"
          style={{ background: c, outline: c === current ? '2px solid var(--text)' : undefined, outlineOffset: 2 }}
        />
      ))}
    </div>
  );
}

function ConfirmDelete({ tag, onConfirm, onCancel }: { tag: Tag; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  const title = `Delete ${tag.name}?`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div role="alertdialog" aria-modal="true" aria-label={title} className="w-[340px] rounded-lg border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="px-4 pb-4 pt-3.5">
          <div className="text-[13px] font-semibold">{title}</div>
          <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
            It will be removed from {tag.count} transaction{tag.count === 1 ? '' : 's'}. The transactions stay as they are.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
