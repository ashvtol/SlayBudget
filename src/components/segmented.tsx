/** Copilot-style segmented picker (1W 1M 3M ...): no frame, the active item is a soft pill. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  'aria-label': string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center gap-1.5">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className="h-[22px] min-w-[38px] rounded-full px-2 text-[11px] font-semibold"
            style={{
              background: active ? 'color-mix(in srgb, var(--accent) 20%, var(--panel))' : 'transparent',
              color: active ? 'var(--text)' : 'var(--muted)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
