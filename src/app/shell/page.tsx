import { NotificationBell } from '@/features/notifications/bell';
import { useRef, useState, type ReactNode } from 'react';

/**
 * The slim header bar every page and panel uses: title, then a toolbar right
 * after it, and optional actions on the far right (Copilot layout).
 */
/** A screen's own actions, then the notification bell, at the right end of the top bar. */
function TopBarActions({ children }: { children?: ReactNode }) {
  return (
    <>
      {children}
      <NotificationBell />
    </>
  );
}

export function PaneHeader({
  title,
  level = 1,
  leading,
  toolbar,
  actions,
}: {
  title: ReactNode;
  level?: 1 | 2;
  leading?: ReactNode;
  toolbar?: ReactNode;
  actions?: ReactNode;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <header
      data-tauri-drag-region
      className="flex h-[45px] shrink-0 items-center gap-3 border-b px-8"
      style={{ background: 'var(--header)', borderColor: 'var(--line)' }}
    >
      {leading}
      {title ? <Heading className="m-0 truncate text-[15px] font-semibold">{title}</Heading> : null}
      {toolbar && <div className="flex items-center gap-1.5">{toolbar}</div>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A single-pane page: header bar plus a scrolling body. */
export function Page({
  title,
  subtitle,
  toolbar,
  actions,
  children,
  padded = true,
}: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  padded?: boolean;
}) {
  return (
    <main aria-label={title} className="flex min-w-0 flex-1 flex-col" style={{ background: 'var(--bg)' }}>
      <PaneHeader title={title} toolbar={toolbar} actions={<TopBarActions>{actions}</TopBarActions>} />
      <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${padded ? 'gap-6 px-8 py-8' : ''}`}>
        {subtitle && <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>{subtitle}</p>}
        {children}
      </div>
    </main>
  );
}

/**
 * List on the left, always-visible detail panel on the right, each with its own
 * header bar. Used by Transactions, Categories and Recurrings.
 */
export function SplitPage({
  title,
  leading,
  toolbar,
  list,
  detailTitle,
  detailActions,
  detail,
  listWidth = 564,
  overlay,
}: {
  title: string;
  leading?: ReactNode;
  toolbar?: ReactNode;
  list: ReactNode;
  detailTitle?: ReactNode;
  detailActions?: ReactNode;
  detail: ReactNode;
  listWidth?: number;
  /** A dialog drawn over the page (e.g. a delete confirmation). */
  overlay?: ReactNode;
}) {
  const [width, setWidth] = useListWidth(title, listWidth);
  return (
    <main aria-label={title} className="flex min-w-0 flex-1" style={{ background: 'var(--bg)' }}>
      <section className="relative flex min-h-0 shrink-0 flex-col border-r" style={{ width, borderColor: 'var(--line)' }}>
        <PaneHeader title={title} leading={leading} toolbar={toolbar} />
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
        <Divider width={width} onChange={setWidth} />
      </section>
      <section aria-label="Details" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PaneHeader title={detailTitle ?? ''} level={2} actions={<TopBarActions>{detailActions}</TopBarActions>} />
        <div className="min-h-0 flex-1 overflow-y-auto">{detail}</div>
      </section>
      {overlay}
    </main>
  );
}

const MIN_LIST = 360;
const MAX_LIST = 900;
const STEP = 16;
const clampWidth = (w: number) => Math.round(Math.min(MAX_LIST, Math.max(MIN_LIST, w)));

/** The list's width on this page: what you dragged it to (remembered per page), or the page's default. */
function useListWidth(page: string, fallback: number): [number, (w: number | null) => void] {
  const key = `split-width:${page}`;
  const [width, setState] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return saved > 0 ? clampWidth(saved) : fallback;
  });
  const set = (w: number | null) => {
    if (w == null) {
      localStorage.removeItem(key);
      setState(fallback);
      return;
    }
    const next = clampWidth(w);
    localStorage.setItem(key, String(next));
    setState(next);
  };
  return [width, set];
}

/** The line between list and detail: drag it (or use ← →) to resize the list; double-click puts it back. */
function Divider({ width, onChange }: { width: number; onChange: (w: number | null) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-label="Resize the list"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={MIN_LIST}
      aria-valuemax={MAX_LIST}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize outline-none hover:bg-[var(--accent)]/30 focus-visible:bg-[var(--accent)]/40"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (drag.current) onChange(drag.current.width + e.clientX - drag.current.x);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(width + (e.key === 'ArrowRight' ? STEP : -STEP));
        }
      }}
    />
  );
}
