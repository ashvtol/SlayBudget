/** A labelled on/off switch (Copilot style). */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 text-[12px]" style={{ color: 'var(--text)' }}>
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative h-[20px] w-[36px] rounded-full transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'var(--line-strong)' }}
      >
        <span className="absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-all" style={{ left: checked ? 18 : 2 }} />
      </button>
    </label>
  );
}
