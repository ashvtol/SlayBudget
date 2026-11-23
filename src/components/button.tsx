import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'destructive' | 'plain';

/** A macOS push button: primary (the one main action), secondary (default), destructive (red text), plain (link). */
export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`btn btn-${variant} ${className}`.trim()} {...rest} />;
}
