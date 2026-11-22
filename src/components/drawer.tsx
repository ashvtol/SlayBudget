import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from './icons';

/** Right-hand slide-over panel (Copilot's "View more" and Settings). Escape or the backdrop closes it. */
export function Drawer({
  open,
  onClose,
  title,
  width = 560,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  /** Buttons beside the close button (e.g. Review). */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div aria-hidden="true" className="drawer-backdrop absolute inset-0" style={{ background: 'rgba(0, 0, 0, 0.45)' }} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="drawer-panel relative flex h-full flex-col border-l outline-none"
        style={{ width, background: 'var(--bg)', borderColor: 'var(--line)' }}
      >
        <div data-tauri-drag-region className="flex h-[45px] shrink-0 items-center justify-between border-b px-6" style={{ background: 'var(--header)', borderColor: 'var(--line)' }}>
          <span className="text-[15px] font-semibold">{title}</span>
          <span className="flex items-center gap-2">
            {actions}
            <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 hover:opacity-80" style={{ color: 'var(--muted)' }}>
              <IconClose size={14} />
            </button>
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
