import { Money } from '@/components/money';
import { CategoryIcon } from '@/components/category-icon';
import { IconTriangleDown, IconTriangleRight } from '@/components/icons';

const wholeDollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;

/**
 * One row of a category tree (Dashboard "Top categories", Categories screen):
 * toggle or dot, badge, name, spent, progress bar against budget, budget.
 */
export function CategoryLine({
  depth,
  name,
  emoji,
  color,
  badge,
  spentCents,
  budgetCents,
  expectedCents = 0,
  toggle,
  open,
  selected = false,
  onSelect,
  barWidth = 120,
}: {
  depth: number;
  name: string;
  emoji: string | null;
  color: string;
  badge?: number;
  spentCents: number;
  budgetCents: number | null;
  /** Bills still due this month: drawn as an outlined segment after the spent part. */
  expectedCents?: number;
  toggle?: () => void;
  open?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  barWidth?: number;
}) {
  const pct = budgetCents ? Math.max(0, Math.min(100, (spentCents / budgetCents) * 100)) : 0;
  const barColor = budgetCents && spentCents + expectedCents > budgetCents ? 'var(--warn)' : 'var(--pos)';
  const expectedPct = budgetCents && expectedCents > 0 ? Math.max(0, Math.min(100 - pct, (expectedCents / budgetCents) * 100)) : 0;
  return (
    <div
      role="row"
      aria-label={name}
      aria-selected={onSelect ? selected : undefined}
      onClick={onSelect}
      className={`flex h-[24px] items-center gap-2 rounded-md text-[13px] ${onSelect ? 'cursor-default' : ''}`}
      style={{ paddingLeft: depth * 18, background: selected ? 'var(--hover)' : 'transparent' }}
    >
      <span className="flex w-3 justify-center" style={{ color }}>
        {toggle ? (
          <button
            type="button"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="flex"
          >
            {open ? <IconTriangleDown size={11} /> : <IconTriangleRight size={11} />}
          </button>
        ) : (
          depth > 0 && <span className="h-[5px] w-[5px] rounded-full" style={{ background: color }} />
        )}
      </span>
      <span
        className="flex h-[18px] min-w-[18px] items-center justify-center rounded px-1 text-[11px] font-semibold"
        style={{ background: `color-mix(in srgb, ${color} 28%, transparent)`, color: `color-mix(in srgb, ${color} var(--pill-tint), var(--pill-ink))` }}
      >
        {badge ?? (emoji && emoji.trim() ? emoji : <CategoryIcon emoji={null} color={color} className="inline-flex" />)}
      </span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <Money cents={spentCents} decimals={false} className="w-[64px] text-right text-[12px] font-semibold" />
      <span className="mx-3 flex h-[4px] overflow-hidden rounded-full" style={{ width: barWidth, background: 'var(--track)' }}>
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
        {expectedCents > 0 && (
          <span
            role="img"
            aria-label={`Expected ${wholeDollars(expectedCents)}`}
            className="block h-full rounded-full"
            style={{ width: `${expectedPct}%`, boxShadow: `inset 0 0 0 1px ${barColor}` }}
          />
        )}
      </span>
      <span className="w-[56px] text-right text-[12px] font-semibold">
        {budgetCents != null ? <Money cents={budgetCents} decimals={false} /> : <span style={{ color: 'var(--subtle)' }}>-</span>}
      </span>
    </div>
  );
}
