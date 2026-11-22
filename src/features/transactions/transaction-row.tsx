import { CategoryPill } from '@/components/category-pill';
import { TagPill } from '@/components/tag-pill';
import { useTagsStore } from '@/lib/stores/tags-store';
import { useDisplayStore } from '@/lib/stores/display-store';
import { Money } from '@/components/money';
import type { Category, Source, Transaction } from '@/lib/types';
import { cleanMerchant } from '@/lib/merchant';
import { txTypeOf } from '@/lib/tx-type';

const TYPE_LABEL = { regular: 'Regular', income: 'Income', transfer: 'Internal transfer' } as const;

/** Copilot's [I] / [T] badge for income and transfers; nothing for regular rows. */
export function TypeBadge({ tx }: { tx: Transaction }) {
  const type = txTypeOf(tx);
  if (type === 'regular') return null;
  return (
    <span
      role="img"
      aria-label={TYPE_LABEL[type]}
      className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] text-[9px] font-bold"
      style={{ background: 'var(--hover)', color: type === 'income' ? 'var(--pos)' : 'var(--muted)', border: '1px solid var(--line-strong)' }}
    >
      {type === 'income' ? 'I' : 'T'}
    </span>
  );
}

/** The neutral pill shown in place of a category on transfers (they aren't categorized). */
export function TransferPill() {
  return (
    <span className="inline-flex h-[18px] items-center rounded-[4px] px-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: 'var(--hover)', color: 'var(--muted)' }}>
      Transfer
    </span>
  );
}

/** Up to two tag pills, then "+N" for the rest (Copilot keeps rows on one line). */
export function RowTags({ tagIds }: { tagIds: number[] | undefined }) {
  const byId = useTagsStore((s) => s.byId);
  const tags = (tagIds ?? []).map((id) => byId[id]).filter((t) => t != null);
  if (tags.length === 0) return null;
  return (
    <span data-testid="row-tags" className="flex min-w-0 shrink items-center gap-1 self-center overflow-hidden">
      {tags.slice(0, 2).map((t) => (
        <TagPill key={t.id} tag={t} />
      ))}
      {tags.length > 2 && <span className="shrink-0 text-[11px]" style={{ color: 'var(--muted)' }}>+{tags.length - 2}</span>}
    </span>
  );
}

/** Merchant as shown in lists: title-cased, falling back to the raw description. */
export function displayMerchant(tx: Transaction): string {
  return cleanMerchant(tx.merchant || tx.description);
}


interface Props {
  tx: Transaction;
  category: Category | undefined;
  source?: Source;
  selected: boolean;
  active: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onPickCategory: () => void;
  /** False for read-only lists (dashboard): no checkbox. */
  selectable?: boolean;
  /** Show the short day ("Nov 1") before the merchant, for lists headed by month. */
  showDate?: boolean;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (day: string) => `${SHORT[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

/** One Copilot-style transaction row: checkbox, merchant + source, pill, amount, review dot. */
export function TransactionRow({ tx, category, source, selected, active, onToggleSelect, onOpen, onPickCategory, selectable = true, showDate = false }: Props) {
  const name = displayMerchant(tx);
  const signs = useDisplayStore((s) => s.signs);
  return (
    <div
      role="row"
      aria-selected={selected}
      aria-current={active ? 'true' : undefined}
      onClick={onOpen}
      className="flex h-[24px] cursor-default items-center gap-3 border-l-2 pl-[14px] pr-5"
      style={{
        background: active ? 'var(--hover)' : 'transparent',
        borderColor: active ? 'var(--accent)' : 'transparent',
      }}
    >
      {selectable && <input
        type="checkbox"
        checked={selected}
        aria-label={`Select ${name}`}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggleSelect}
        className="h-[13px] w-[13px] shrink-0 accent-[var(--accent)]"
      />}
      {showDate && (
        <span data-testid="row-date" className="w-[44px] shrink-0 text-[13px]" style={{ color: 'var(--muted)' }}>
          {shortDay(tx.postedOn)}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[13px]">
        <span className="max-w-[60%] shrink-0 truncate">{name}</span>
        <TypeBadge tx={tx} />
        {tx.recurringId != null && (
          <span
            role="img"
            aria-label="Recurring"
            className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] text-[9px] font-bold"
            style={{ background: 'var(--hover)', color: 'var(--accent)', border: '1px solid var(--line-strong)' }}
          >
            R
          </span>
        )}
        {source && <span className="min-w-0 shrink truncate" style={{ color: 'var(--muted)' }}>{source.name}</span>}
        <RowTags tagIds={tx.tagIds} />
      </span>
      <span className="flex w-[150px] shrink-0 justify-start" onClick={(e) => e.stopPropagation()}>
        {txTypeOf(tx) === 'transfer' ? <TransferPill /> : <CategoryPill category={category} onClick={onPickCategory} />}
      </span>
      <span data-testid="amount" className="w-[78px] shrink-0 text-right text-[13px] font-semibold" style={{ color: txTypeOf(tx) === 'transfer' ? 'var(--muted)' : tx.amountCents > 0 ? 'var(--pos)' : 'var(--text)' }}>
        <Money cents={tx.amountCents} tone={tx.amountCents > 0 && txTypeOf(tx) !== 'transfer' ? 'pos' : 'default'} currency={tx.currency} sign={signs ? 'always' : 'none'} />
      </span>
      <span className="flex w-2 shrink-0 justify-center">
        {!tx.reviewed && <span aria-label="Needs review" role="img" className="h-[5px] w-[5px] rounded-full" style={{ background: 'var(--accent)' }} />}
      </span>
    </div>
  );
}
