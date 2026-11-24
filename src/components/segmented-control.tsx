import { useLayoutEffect, useRef, useState } from 'react';

/** A macOS segmented control for a few form choices: the selected one carries a pill that slides between them. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  'aria-label': ariaLabel,
}: {
  options: readonly { id: T; label: string }[];
  value: T | null | undefined;
  onChange: (id: T) => void;
  /** Stretch to the container with equal-width segments (like NSSegmentedControl's "fill equally"). */
  fill?: boolean;
  'aria-label': string;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const group = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = value != null ? refs.current.get(value) : undefined;
      setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    measure();
    // Filled segments change width with the window: keep the pill on its segment.
    if (!fill || typeof ResizeObserver === 'undefined' || !group.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(group.current);
    return () => ro.disconnect();
  }, [value, options, fill]);
  return (
    <div ref={group} role="radiogroup" aria-label={ariaLabel} className={fill ? 'segmented segmented-fill' : 'segmented'}>
      <span data-segment-thumb aria-hidden="true" className="segmented-thumb" style={thumb ? { left: thumb.left, width: thumb.width } : { opacity: 0 }} />
      {options.map((o, i) => (
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
          data-divider={i > 0 && o.id !== value && options[i - 1].id !== value ? 'true' : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
