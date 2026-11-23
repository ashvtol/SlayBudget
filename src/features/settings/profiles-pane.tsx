import { useEffect, useState } from 'react';
import { useProfileStore } from '@/lib/stores/profile-store';
import { Button } from '@/components/button';

/** Manage household members: add, rename, remove. The combined view is implicit. */
export function ProfilesPane() {
  const { profiles, load, create, rename, remove } = useProfileStore();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!name) return;
    await create(name);
    setNewName('');
  };

  const commitRename = async (id: number) => {
    const name = editName.trim();
    if (name) await rename(id, name);
    setEditingId(null);
  };

  return (
    <section aria-label="Profiles" className="flex flex-col gap-4 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
        Add household members to track separately. The dashboard’s “All” view combines everyone.
      </p>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {profiles.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--line)' }}>
            {editingId === p.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => void commitRename(p.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename(p.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                aria-label={`Rename ${p.name}`}
                className="flex-1 rounded-md border bg-transparent px-2 py-1 text-sm"
                style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
              />
            ) : (
              <span className="flex items-center gap-2 text-sm">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                {p.name}
              </span>
            )}
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setEditingId(p.id); setEditName(p.name); }}
                className="min-h-7 rounded-md border px-2 text-xs"
                style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => void remove(p.id)}
                aria-label={`Remove ${p.name}`}
                className="min-h-7 rounded-md px-2 text-xs"
                style={{ color: 'var(--neg)' }}
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="Add a person…"
          aria-label="New profile name"
          className="flex-1 rounded-lg border bg-transparent px-2.5 py-2 text-sm"
          style={{ borderColor: 'var(--line)', color: 'var(--text)' }}
        />
        <Button onClick={() => void add()} disabled={!newName.trim()}>
          Add
        </Button>
      </div>
    </section>
  );
}
