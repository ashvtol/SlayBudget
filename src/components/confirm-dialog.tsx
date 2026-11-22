import { useEffect } from 'react';

/** A small "are you sure?" dialog for destructive actions. Escape or Cancel closes it without a change. */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div role="alertdialog" aria-label={title} className="w-[360px] rounded-lg border" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="px-4 pb-4 pt-3.5">
          <div className="text-[13px] font-semibold">{title}</div>
          <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>{body}</p>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
          <button type="button" autoFocus onClick={onCancel} className="h-[28px] rounded-md border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)', background: 'var(--bg)' }}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className="h-[28px] rounded-md px-3 text-[12px] font-semibold" style={{ background: 'var(--neg)', color: '#fff' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
