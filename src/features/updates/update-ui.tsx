import { Fragment, useEffect, type ReactNode } from 'react';
import type { ChangelogSection } from '@/lib/changelog';
import { useUpdateStore } from './update-store';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso: string | null) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}` : '');

/** Inline markdown we use in the changelog: **bold** and `code`. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i} className="rounded px-1 text-[11px]" style={{ background: 'var(--hover)' }}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A changelog section's body: ### subheadings, bullet lists (with wrapped lines) and paragraphs. */
function SectionBody({ body }: { body: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="m-0 mb-2 list-disc pl-5 text-[13px] leading-[1.5]">
          {list.map((item, i) => <li key={i}>{inline(item)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('### ')) {
      flush();
      blocks.push(<div key={blocks.length} className="mb-1 mt-2 text-[11px] font-semibold uppercase tracking-[0.05em]" style={{ color: 'var(--muted)' }}>{line.slice(4)}</div>);
    } else if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
    } else if (/^\s+\S/.test(raw) && list.length) {
      list[list.length - 1] += ` ${line.trim()}`; // a wrapped bullet
    } else if (line.trim()) {
      flush();
      blocks.push(<p key={blocks.length} className="m-0 mb-2 text-[13px]">{inline(line)}</p>);
    } else {
      flush();
    }
  }
  flush();
  return <>{blocks}</>;
}

/** What's new between the installed version and the update, newest first. */
export function ChangelogView({ sections, fallback }: { sections: ChangelogSection[]; fallback?: string }) {
  if (sections.length === 0) {
    return fallback?.trim() ? <p className="m-0 whitespace-pre-wrap text-[13px]">{fallback}</p> : <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>No release notes.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.version}>
          <h3 className="m-0 mb-1 flex items-baseline gap-2 text-[14px] font-semibold">
            {s.version}
            {s.date && <span className="text-[12px] font-normal" style={{ color: 'var(--muted)' }}>{longDate(s.date)}</span>}
          </h3>
          <SectionBody body={s.body} />
        </section>
      ))}
    </div>
  );
}

/** Asks before updating, with the changelog since the installed version. */
export function UpdateDialog() {
  const { dialogOpen, available, currentVersion, sections, status, progress, error, install, later } = useUpdateStore();
  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && status !== 'installing' && void later();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialogOpen, status, later]);
  if (!dialogOpen || !available) return null;
  const installing = status === 'installing';
  const pct = progress?.total ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div role="dialog" aria-modal="true" aria-label="Update available" className="flex max-h-[80vh] w-[520px] flex-col rounded-xl border shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
        <div className="px-6 pb-3 pt-5">
          <div className="text-[16px] font-semibold">SlayBudget {available.version} is available</div>
          <p className="m-0 mt-1 text-[12px]" style={{ color: 'var(--muted)' }}>
            You have {currentVersion}. Here's what's new since then.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-y px-6 py-4" style={{ borderColor: 'var(--line)' }}>
          <ChangelogView sections={sections} fallback={available.notes} />
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-3">
          {installing && (
            <div role="progressbar" aria-label="Downloading update" aria-valuenow={pct ?? undefined} className="mr-auto h-[6px] w-40 overflow-hidden rounded-full" style={{ background: 'var(--hover)' }}>
              <div className="h-full" style={{ width: `${pct ?? 30}%`, background: 'var(--accent)' }} />
            </div>
          )}
          {error && !installing && <span className="mr-auto text-[12px]" style={{ color: 'var(--neg)' }}>{error}</span>}
          <button type="button" disabled={installing} onClick={() => void later()} className="h-[30px] rounded-md border px-3 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)', background: 'var(--bg)' }}>
            Later
          </button>
          <button type="button" autoFocus disabled={installing} onClick={() => void install()} className="h-[30px] rounded-md px-3 text-[12px] font-semibold disabled:opacity-60" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>
            {installing ? 'Installing…' : 'Install and restart'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Sidebar footer button while an update waits; reopens the dialog. */
export function UpdateBadge() {
  const { status, available, openDialog } = useUpdateStore();
  if (status !== 'available' || !available) return null;
  return (
    <button
      type="button"
      onClick={openDialog}
      title={`SlayBudget ${available.version} is ready to install`}
      className="flex h-[24px] items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold"
      style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}
    >
      <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full" style={{ background: 'var(--accent)' }} />
      Update available
    </button>
  );
}
