export function Logo() {
  return (
    <div role="img" aria-label="SlayBudget" className="flex items-center gap-2 px-1">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 26 26" className="shrink-0">
        <circle cx="13" cy="13" r="10" fill="none" stroke="var(--line-strong)" strokeWidth="3" />
        <circle cx="13" cy="13" r="10" transform="rotate(-90 13 13)" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeDasharray="44 63" />
      </svg>
      <span className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>SlayBudget</span>
    </div>
  );
}
