import { useLayoutEffect, useRef, useState } from 'react';

/** A macOS segmented control for a few form choices: the selected one carries a pill that slides between them. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  options: readonly { id: T; label: string }[];
  value: T | null | undefined;
  onChange: (id: T) => void;
  'aria-label': string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = value != null ? refs.current.get(value) : undefined;
    setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, [value, options]);
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="segmented">
      <span data-segment-thumb aria-hidden="true" className="segmented-thumb" style={thumb ? { left: thumb.left, width: thumb.width } : { opacity: 0 }} />
      {options.map((o) => (
        <button
          key={o.id}
          ref={(el) => {
            if (el) refs.current.set(o.id, el);
          }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className="segmented-option"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
