import { useEffect, useMemo, useRef, useState } from 'react';
import { IconSettings } from '@/components/icons';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTagsStore } from '@/lib/stores/tags-store';
import { useTransactionsStore } from './transactions-store';

/**
 * Copilot's tag popover: "Add tags..." search, a checkbox per tag (dot + name), a Create row for a
 * new name, and "View tag settings". Works on one row (detail pane) or many (bulk action): a tag on
 * only some rows shows a dash, and clicking it adds it to all.
 */
export function TagPicker({ ids, onClose, className = 'left-0 top-[30px]' }: { ids: number[]; onClose: () => void; className?: string }) {
  const tags = useTagsStore((s) => s.tags);
  const transactions = useTransactionsStore((s) => s.transactions);
  const toggleTag = useTransactionsStore((s) => s.toggleTag);
  const createTag = useTransactionsStore((s) => s.createTag);
  const openSettingsPane = useNavStore((s) => s.openSettingsPane);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const rows = useMemo(() => {
    const target = new Set(ids);
    return transactions.filter((t) => target.has(t.id));
  }, [ids, transactions]);
  const state = (tagId: number): 'true' | 'false' | 'mixed' => {
    const n = rows.filter((t) => t.tagIds?.includes(tagId)).length;
    return n === 0 ? 'false' : n === rows.length ? 'true' : 'mixed';
  };

  const q = query.trim();
  const shown = tags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const canCreate = q.length > 0 && !tags.some((t) => t.name.toLowerCase() === q.toLowerCase());
  const create = async () => {
    try {
      await createTag(ids, q);
      setQuery('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Tags"
      className={`absolute z-40 w-[240px] rounded-lg border shadow-2xl ${className}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (canCreate) void create();
          else if (shown.length === 1) void toggleTag(ids, shown[0].id);
        }}
        placeholder="Add tags..."
        aria-label="Add tags"
        className="field-bare w-full border-b bg-transparent px-3 py-2.5 text-[13px] outline-none"
        style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
      />
      <div className="max-h-[40vh] overflow-y-auto p-1.5">
        {shown.map((t) => {
          const checked = state(t.id);
          return (
            <button
              key={t.id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={t.name}
              onClick={() => void toggleTag(ids, t.id)}
              className="flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
              style={{ color: 'var(--text)' }}
            >
              <span
                aria-hidden="true"
                className="flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border text-[10px] font-bold leading-none"
                style={{
                  borderColor: checked === 'false' ? 'var(--line-strong)' : 'var(--accent)',
                  background: checked === 'false' ? 'transparent' : 'var(--accent)',
                  color: '#fff',
                }}
              >
                {checked === 'true' ? '✓' : checked === 'mixed' ? '–' : ''}
              </span>
              <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: t.color }} />
              <span className="truncate">{t.name}</span>
            </button>
          );
        })}
        {canCreate && (
          <button
            type="button"
            onClick={() => void create()}
            aria-label={`Create “${q}”`}
            className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
            style={{ color: 'var(--accent)' }}
          >
            + Create “{q}”
          </button>
        )}
        {tags.length === 0 && !q && (
          <p className="m-0 px-2 py-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>No tags yet. Type a name to create one.</p>
        )}
        {error && (
          <p role="alert" className="m-0 px-2 py-1 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          onClose();
          openSettingsPane('tags');
        }}
        className="flex h-[36px] w-full items-center gap-2 border-t px-3 text-left text-[13px] hover:bg-[var(--hover)]"
        style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
      >
        <IconSettings size={13} />
        View tag settings
      </button>
    </div>
  );
}
