import { useProfileStore } from '@/lib/stores/profile-store';

/** Switch between household members, or the combined "All" view. */
export function ProfileSwitcher() {
  const { profiles, activeProfileId, setActive } = useProfileStore();
  if (profiles.length <= 1) return null;

  const options: { id: number | null; label: string; color?: string }[] = [
    { id: null, label: 'All' },
    ...profiles.map((p) => ({ id: p.id, label: p.name, color: p.color })),
  ];

  return (
    <div role="radiogroup" aria-label="Active profile" className="flex flex-wrap gap-1">
      {options.map((o) => {
        const active = activeProfileId === o.id;
        return (
          <button
            key={o.id ?? 'all'}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setActive(o.id)}
            className="flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium"
            style={{
              borderColor: active ? 'var(--accent)' : 'var(--line)',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--on-accent)' : 'var(--muted)',
            }}
          >
            {o.color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: o.color }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
