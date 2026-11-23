// The Insights spending map: where the money went in a period (treemap tiles sized by spend) and
// how each category changed against the period before (tile color).

import { cleanMerchant } from '@/lib/merchant';
import { isRegular, spendOf } from '@/lib/tx-type';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';

export interface Window {
  from: string | null;
  to: string | null;
}

export interface SpendTile {
  categoryId: number | null;
  name: string;
  emoji: string | null;
  groupName: string;
  color: string;
  valueCents: number;
  previousCents: number;
  /** Change vs the previous period in %, or null when there was nothing before (new). */
  changePct: number | null;
  count: number;
  avgCents: number;
  /** Share of all spending in the period (0..1). */
  share: number;
  topMerchants: { name: string; cents: number }[];
  /** Every merchant in the category, largest first (the third level of the map). */
  merchants: MerchantTile[];
}

export interface MerchantTile {
  name: string;
  cents: number;
  count: number;
  previousCents: number;
  changePct: number | null;
}

export interface SpendGroup {
  name: string;
  color: string;
  valueCents: number;
  previousCents: number;
  children: SpendTile[];
}

export interface SpendMap {
  totalCents: number;
  groups: SpendGroup[];
  /** False for all time: nothing comes before, so colors show categories instead of change. */
  compared: boolean;
  /** Spending left off the map by the user's Hide choices. */
  hiddenCents: number;
  hiddenNames: string[];
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The window of the same length immediately before `w`; null for all time. */
export function previousWindow(w: Window): Window | null {
  if (!w.from || !w.to) return null;
  const days = Math.round((at(w.to) - at(w.from)) / DAY);
  const to = at(w.from) - DAY;
  return { from: iso(to - days * DAY), to: iso(to) };
}

const inWindow = (t: Transaction, w: Window) => (!w.from || t.postedOn >= w.from) && (!w.to || t.postedOn <= w.to);
const UNCATEGORIZED = 'Uncategorized';

export function buildSpendMap(input: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  window: Window;
  previous: Window | null;
  /** First day with any data; when it falls inside the previous period, there's nothing fair to compare. */
  dataStart?: string | null;
  /** Category keys to leave off the map: the category id as text, or "none" for uncategorized. */
  hidden?: Set<string>;
}): SpendMap {
  const previous = input.previous && (!input.dataStart || !input.previous.from || input.dataStart <= input.previous.from) ? input.previous : null;
  const catById = new Map(input.categories.map((c) => [c.id, c]));
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  // Regular spending in non-excluded categories (income, transfers and excluded categories don't count).
  const counts = (t: Transaction) => {
    if (!isRegular(t)) return false;
    if (t.categoryId == null) return true;
    const c = catById.get(t.categoryId);
    return c != null && !c.excluded && c.kind === 'expense';
  };

  const cur = new Map<string, { cents: number; count: number; merchants: Map<string, { cents: number; count: number }> }>();
  const prev = new Map<string, number>();
  const prevMerchant = new Map<string, number>();
  const key = (t: Transaction) => (t.categoryId == null ? 'none' : String(t.categoryId));
  for (const t of input.transactions) {
    if (!counts(t)) continue;
    if (inWindow(t, input.window)) {
      const e = cur.get(key(t)) ?? { cents: 0, count: 0, merchants: new Map<string, { cents: number; count: number }>() };
      e.cents += spendOf(t);
      e.count += 1;
      const m = e.merchants.get(t.merchant) ?? { cents: 0, count: 0 };
      m.cents += spendOf(t);
      m.count += 1;
      e.merchants.set(t.merchant, m);
      cur.set(key(t), e);
    } else if (previous && inWindow(t, previous)) {
      prev.set(key(t), (prev.get(key(t)) ?? 0) + spendOf(t));
      const mk = `${key(t)}|${t.merchant}`;
      prevMerchant.set(mk, (prevMerchant.get(mk) ?? 0) + spendOf(t));
    }
  }
  const hidden = input.hidden ?? new Set<string>();
  let hiddenCents = 0;
  const hiddenNames: string[] = [];
  const change = (now: number, before: number) => (previous && before > 0 ? Math.round(((now - before) / before) * 100) : null);

  const tiles: (SpendTile & { groupId: number | null })[] = [];
  for (const [k, e] of cur) {
    if (e.cents <= 0) continue;
    const c = k === 'none' ? undefined : catById.get(Number(k));
    if (hidden.has(k)) {
      hiddenCents += e.cents;
      hiddenNames.push(c?.name ?? UNCATEGORIZED);
      continue;
    }
    const g = c ? groupById.get(c.groupId) : undefined;
    const previousCents = Math.max(0, prev.get(k) ?? 0);
    tiles.push({
      categoryId: c?.id ?? null,
      groupId: g?.id ?? null,
      name: c?.name ?? UNCATEGORIZED,
      emoji: c?.emoji ?? null,
      groupName: g?.name ?? UNCATEGORIZED,
      color: c?.color ?? g?.color ?? '#8e8e93',
      valueCents: e.cents,
      previousCents,
      changePct: change(e.cents, previousCents),
      count: e.count,
      avgCents: Math.round(e.cents / e.count),
      share: 0,
      topMerchants: [...e.merchants.entries()]
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 3)
        .map(([m, v]) => ({ name: cleanMerchant(m), cents: Math.max(0, v.cents) })),
      merchants: [...e.merchants.entries()]
        .sort((a, b) => b[1].cents - a[1].cents)
        .map(([m, v]) => {
          const before = Math.max(0, prevMerchant.get(`${k}|${m}`) ?? 0);
          return { name: cleanMerchant(m), cents: Math.max(0, v.cents), count: v.count, previousCents: before, changePct: change(v.cents, before) };
        }),
    });
  }
  const totalCents = tiles.reduce((s, t) => s + t.valueCents, 0);
  for (const t of tiles) t.share = totalCents ? t.valueCents / totalCents : 0;

  const byGroup = new Map<string, SpendGroup>();
  for (const t of tiles) {
    const g = t.groupId != null ? groupById.get(t.groupId) : undefined;
    const name = g?.name ?? UNCATEGORIZED;
    const entry = byGroup.get(name) ?? { name, color: g?.color ?? '#8e8e93', valueCents: 0, previousCents: 0, children: [] };
    entry.valueCents += t.valueCents;
    entry.previousCents += t.previousCents;
    const { groupId: _groupId, ...tile } = t;
    void _groupId;
    entry.children.push(tile);
    byGroup.set(name, entry);
  }
  const groups = [...byGroup.values()].sort((a, b) => b.valueCents - a.valueCents);
  for (const g of groups) g.children.sort((a, b) => b.valueCents - a.valueCents);
  hiddenNames.sort((a, b) => a.localeCompare(b));
  return { totalCents, groups, compared: previous != null, hiddenCents, hiddenNames };
}

// ----- chart -----

export interface MapTokens {
  pos: string;
  neg: string;
  accent: string;
  muted: string;
  panel: string;
  text: string;
}

/** `#rrggbb` with an alpha byte. */
const withAlpha = (hex: string, alpha: number) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;

/** Tile color: red when spending rose, green when it fell (stronger with the change, capped at
 *  ±100%), muted when about flat (±5%), accent for new spending; category color without comparison. */
export function tileColor(tile: Pick<SpendTile, 'changePct' | 'color'>, tokens: MapTokens, compared: boolean): string {
  if (!compared) return withAlpha(tile.color, 0.85);
  if (tile.changePct == null) return withAlpha(tokens.accent, 0.8);
  if (Math.abs(tile.changePct) <= 5) return withAlpha(tokens.muted, 0.55);
  const strength = 0.4 + 0.6 * Math.min(1, Math.abs(tile.changePct) / 100);
  return withAlpha(tile.changePct > 0 ? tokens.neg : tokens.pos, strength);
}

export type LabelPlan = 'full' | 'inline' | 'name' | 'vertical' | 'verticalName' | 'squeezed';

/**
 * Rough width of a tile label's name line at 12px: about 7px a character, emoji wider, plus the
 * "▶ " drill-in arrow ECharts puts in front and a little padding.
 */
const nameWidth = (name: string) => [...name].length * 7 + (name.match(/\p{Extended_Pictographic}/gu)?.length ?? 0) * 8 + 24;
const AMOUNT_WIDTH = 64;

/**
 * How a label fits its tile: name over amount; on one line ("Name $x") or just the name in a
 * short tile; turned on its side in a tall, narrow one. Otherwise 'squeezed': left for ECharts to
 * truncate.
 */
export function labelPlan(width: number, height: number, name: string, measure: (name: string) => number = nameWidth): LabelPlan {
  const w = measure(name);
  if (width >= w && height >= 44) return 'full';
  if (height >= 18 && width >= w + AMOUNT_WIDTH) return 'inline';
  if (height >= 18 && width >= w) return 'name';
  if (height >= w && width >= 44) return 'vertical';
  if (height >= w && width >= 20) return 'verticalName';
  return 'squeezed';
}
