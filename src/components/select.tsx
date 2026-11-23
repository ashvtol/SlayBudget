import type { SelectHTMLAttributes } from 'react';

/** A macOS pop-up button: the native select (its list is the system's own) with the ↕ badge on the right. */
/** `selectClassName` sizes the pop-up itself (a taller form row, say). */
export function Select({ className = '', selectClassName = '', style, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { selectClassName?: string }) {
  return (
    <span className={`popup-wrap ${className}`.trim()} style={style}>
      <select className={`popup ${selectClassName}`.trim()} {...rest} />
      <span data-popup-badge aria-hidden="true" className="popup-badge">
        <svg width="8" height="11" viewBox="0 0 8 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 4 4 1.5 6.5 4M1.5 7 4 9.5 6.5 7" />
        </svg>
      </span>
    </span>
  );
}
