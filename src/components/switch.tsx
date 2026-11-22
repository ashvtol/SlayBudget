const SIZES = {
  /** macOS mini switch, for inline options and per-kind Bell/Banner. */
  sm: { track: 'h-[15px] w-[26px]', knob: 11, on: 13 },
  /** macOS regular switch, for a setting's main on/off at the row's end. */
  md: { track: 'h-[18px] w-[32px]', knob: 14, on: 16 },
  /** The original Copilot-style size. */
  lg: { track: 'h-[20px] w-[36px]', knob: 16, on: 18 },
} as const;

/** A labelled on/off switch that slides, like macOS. */
export function Switch({
  label,
  checked,
  onChange,
  size = 'lg',
  disabled = false,
  hideLabel = false,
  labelSide = 'before',
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  size?: keyof typeof SIZES;
  disabled?: boolean;
  /** Keep the label for screen readers only (the row already names it). */
  hideLabel?: boolean;
  labelSide?: 'before' | 'after';
}) {
  const s = SIZES[size];
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${s.track}`}
      style={{ background: checked ? 'var(--accent)' : 'var(--line-strong)' }}
    >
      <span className="absolute top-[2px] rounded-full bg-white transition-all" style={{ width: s.knob, height: s.knob, left: checked ? s.on : 2 }} />
    </button>
  );
  if (hideLabel) return toggle;
  const text = <span>{label}</span>;
  return (
    <label className={`flex items-center ${size === 'sm' ? 'gap-1.5' : 'gap-2.5'} text-[12px]`} style={{ color: 'var(--text)' }}>
      {labelSide === 'before' ? text : toggle}
      {labelSide === 'before' ? toggle : text}
    </label>
  );
}
