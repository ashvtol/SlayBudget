import type { ReactNode } from 'react';
import { IconArrowUpRight } from './icons';

/** Copilot-style card: subtle panel, title on the left, an uppercase link on the right. */
export function Card({
  title,
  linkLabel,
  onLink,
  actions,
  children,
  className = '',
  padded = true,
  'aria-label': ariaLabel,
}: {
  title?: ReactNode;
  linkLabel?: string;
  onLink?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  'aria-label'?: string;
}) {
  return (
    <section
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      className={`rounded-[10px] border ${padded ? 'p-5' : ''} ${className}`}
      style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
    >
      {(title || linkLabel || actions) && (
        <header className={`flex items-center justify-between gap-3 ${padded ? 'mb-4' : 'px-5 pt-5 pb-4'}`}>
          {title && <h2 className="m-0 text-[14px] font-semibold">{title}</h2>}
          <div className="flex items-center gap-2">
            {actions}
            {linkLabel && <CardLink label={linkLabel} onClick={onLink} />}
          </div>
        </header>
      )}
      {children}
    </section>
  );
}

export function CardLink({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="label-caps inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--muted)' }}>
      {label}
      <IconArrowUpRight size={13} />
    </button>
  );
}
