import type { Category, Source, Tag, TransactionFilter, TxType } from '@/lib/types';

/** One value picked in the Filter menu. */
export type FilterValue =
  | { kind: 'account'; value: number }
  | { kind: 'category'; value: number }
  | { kind: 'month'; value: string }
  | { kind: 'keyword'; value: string }
  | { kind: 'recurring'; value: number }
  | { kind: 'review'; value: boolean }
  | { kind: 'tag'; value: number }
  | { kind: 'type'; value: TxType };

export const TYPE_LABELS: Record<TxType, string> = { regular: 'Regular', income: 'Income', transfer: 'Internal transfer' };

export interface FilterPill {
  key: string;
  filter: FilterValue;
  label: string;
  emoji?: string | null;
  /** Category color for a tinted pill. */
  color?: string | null;
  /** Account or tag dot color. */
  dot?: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "June 2026" from "2026-06". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function toggleIn<T>(list: T[] | undefined, value: T): T[] | undefined {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return next.length ? next : undefined;
}

/** The filter change for picking a value: list kinds add or remove it; single kinds set it, or clear it when already set. */
export function togglePatch(f: TransactionFilter, v: FilterValue): Partial<TransactionFilter> {
  switch (v.kind) {
    case 'account':
      return { sourceIds: toggleIn(f.sourceIds, v.value) };
    case 'category':
      return { categoryIds: toggleIn(f.categoryIds, v.value) };
    case 'month':
      return { months: toggleIn(f.months, v.value) };
    case 'recurring':
      return { recurringIds: toggleIn(f.recurringIds, v.value) };
    case 'type':
      return { types: toggleIn(f.types, v.value) };
    case 'tag':
      return { tagIds: toggleIn(f.tagIds, v.value) };
    case 'keyword': {
      const text = v.value.trim();
      return { text: text && text !== f.text ? text : undefined };
    }
    case 'review':
      return { reviewed: f.reviewed === v.value ? undefined : v.value };
  }
}

/** Remove one pill's value. */
export function removePillPatch(f: TransactionFilter, pill: FilterPill): Partial<TransactionFilter> {
  if (pill.filter.kind === 'keyword') return { text: undefined };
  if (pill.filter.kind === 'review') return { reviewed: undefined };
  return togglePatch(f, pill.filter);
}

/** Every filter kind cleared (profile and paging kept). */
export function clearAllPatch(): Partial<TransactionFilter> {
  return { sourceIds: undefined, categoryIds: undefined, months: undefined, merchants: undefined, recurringIds: undefined, tagIds: undefined, types: undefined, text: undefined, reviewed: undefined, from: undefined, to: undefined };
}

export function isFiltered(f: TransactionFilter): boolean {
  return Boolean(
    f.sourceIds?.length || f.categoryIds?.length || f.months?.length || f.merchants?.length || f.recurringIds?.length || f.tagIds?.length || f.types?.length || f.text?.trim() || f.reviewed != null || f.from || f.to,
  );
}

/** Pills in this order: account, category, month, keyword, recurring, tag, type, review. */
export function filterPills(
  f: TransactionFilter,
  ctx: { categoriesById: Record<number, Category>; sourcesById: Record<number, Source>; sourceColors: Record<number, string>; recurringNames?: Record<number, string>; tagsById?: Record<number, Tag> },
): FilterPill[] {
  const pills: FilterPill[] = [];
  for (const id of f.sourceIds ?? []) {
    pills.push({ key: `account-${id}`, filter: { kind: 'account', value: id }, label: ctx.sourcesById[id]?.name ?? 'Account', dot: ctx.sourceColors[id] });
  }
  for (const id of f.categoryIds ?? []) {
    const c = ctx.categoriesById[id];
    pills.push({ key: `category-${id}`, filter: { kind: 'category', value: id }, label: c?.name ?? 'Category', emoji: c?.emoji, color: c?.color });
  }
  for (const m of f.months ?? []) pills.push({ key: `month-${m}`, filter: { kind: 'month', value: m }, label: monthLabel(m) });
  if (f.text?.trim()) pills.push({ key: 'keyword', filter: { kind: 'keyword', value: f.text }, label: `“${f.text.trim()}”` });
  for (const id of f.recurringIds ?? []) pills.push({ key: `recurring-${id}`, filter: { kind: 'recurring', value: id }, label: ctx.recurringNames?.[id] ?? 'Recurring' });
  for (const id of f.tagIds ?? []) {
    const tag = ctx.tagsById?.[id];
    pills.push({ key: `tag-${id}`, filter: { kind: 'tag', value: id }, label: tag?.name ?? 'Tag', dot: tag?.color });
  }
  for (const t of f.types ?? []) pills.push({ key: `type-${t}`, filter: { kind: 'type', value: t }, label: TYPE_LABELS[t] });
  if (f.reviewed != null) pills.push({ key: 'review', filter: { kind: 'review', value: f.reviewed }, label: f.reviewed ? 'Reviewed' : 'Not reviewed' });
  return pills;
}

/** Months that have transactions, grouped by year, newest first. */
export function monthsByYear(days: string[]): { year: string; months: string[] }[] {
  const months = [...new Set(days.map((d) => d.slice(0, 7)))].sort().reverse();
  const out: { year: string; months: string[] }[] = [];
  for (const m of months) {
    const year = m.slice(0, 4);
    const last = out[out.length - 1];
    if (last?.year === year) last.months.push(m);
    else out.push({ year, months: [m] });
  }
  return out;
}
