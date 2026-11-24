import { useEffect, useRef, type ReactNode } from 'react';

/** Small right-aligned menu under a header button; Escape or an outside click closes it. */
export function ActionsPopover({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" aria-label={label} className="absolute right-0 top-[34px] z-30 w-[230px] rounded-lg border p-1.5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      {children}
    </div>
  );
}

export function MenuItem({ children, onClick, role = 'menuitem', checked, danger = false }: { children: ReactNode; onClick: () => void; role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'; checked?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'menuitem' ? undefined : !!checked}
      onClick={onClick}
      className="flex min-h-[28px] w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
      style={{ color: danger ? 'var(--neg)' : 'var(--text)' }}
    >
      {children}
    </button>
  );
}
