import type { Tag } from '@/lib/types';

/** Copilot's tag label: an outlined pill with the tag's colored dot and its name. */
export function TagPill({ tag, size = 'sm' }: { tag: Pick<Tag, 'name' | 'color'>; size?: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-[24px] px-2.5 text-[12px] gap-1.5' : 'h-[18px] px-1.5 text-[11px] gap-1';
  return (
    <span
      className={`inline-flex min-w-0 max-w-[140px] shrink items-center rounded-full border leading-none ${box}`}
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
    >
      <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: tag.color }} />
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
