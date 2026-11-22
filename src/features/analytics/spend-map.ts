// The Insights spending map: where the money went in a period (treemap tiles sized by spend) and
// how each category changed against the period before (tile color).

import type { EChartsOption } from 'echarts';
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

const money = (cents: number) =>
  `$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedMoney = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(cents)}`;
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
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

interface TileDatum {
  name: string;
  value: number;
  merchant?: MerchantTile;
  categoryName?: string;
  groupChange?: number | null;
  tile?: SpendTile;
  group?: SpendGroup;
  share: number;
  itemStyle: { color: string; borderColor?: string };
  children?: TileDatum[];
}

// The same layout as ECharts' standard tooltip on the other charts: a grey heading, then rows of
// a colored dot, a label and a bold value on the right.
const marker = (color: string) =>
  `<span style="display:inline-block;width:10px;height:10px;border-radius:10px;background:${color};flex:none"></span>`;
const row = (label: string, value: string, color: string) =>
  `<div data-row="${escapeHtml(label)}" style="display:flex;align-items:center;gap:6px;margin-top:10px;line-height:1;font-size:14px;color:#666">` +
  `${marker(color)}<span>${escapeHtml(label)}</span>` +
  `<span style="margin-left:auto;padding-left:20px;font-weight:900;color:#666">${escapeHtml(value)}</span></div>`;
const heading = (text: string) => `<div style="font-size:14px;color:#666;line-height:1">${escapeHtml(text)}</div>`;
const changeText = (now: number, before: number) => {
  const pct = Math.round(((now - before) / before) * 100);
  return `${signedMoney(now - before)} (${pct >= 0 ? '+' : ''}${pct}%)`;
};

function tooltipHtml(d: TileDatum, compared: boolean): string {
  const color = d.itemStyle.color.slice(0, 7);
  const parts: string[] = [];
  if (d.merchant) {
    const m = d.merchant;
    parts.push(heading(`${m.name} · ${d.categoryName ?? ''}`));
    parts.push(row('Spent', money(m.cents), color));
    parts.push(row('Share', `${(d.share * 100).toFixed(1)}%`, color));
    if (compared) parts.push(row('vs previous period', m.previousCents > 0 ? changeText(m.cents, m.previousCents) : 'New', color));
    parts.push(row('Visits', String(m.count), color));
    parts.push(row('Average', money(Math.round(m.cents / m.count)), color));
    return parts.join('');
  }
  const t = d.tile;
  const valueCents = t?.valueCents ?? d.group?.valueCents ?? d.value;
  const previousCents = t?.previousCents ?? d.group?.previousCents ?? 0;
  const title = t ? `${t.emoji ? `${t.emoji} ` : ''}${t.name}${t.groupName !== t.name ? ` · ${t.groupName}` : ''}` : d.name;
  parts.push(heading(title));
  parts.push(row('Spent', money(valueCents), color));
  parts.push(row('Share', `${(d.share * 100).toFixed(1)}%`, color));
  if (compared) parts.push(row('vs previous period', previousCents > 0 ? changeText(valueCents, previousCents) : 'New', color));
  if (t) {
    parts.push(row('Transactions', String(t.count), color));
    parts.push(row('Average', money(t.avgCents), color));
    for (const m of t.topMerchants.filter((x) => x.cents > 0)) parts.push(row(m.name, money(m.cents), '#c8ced8'));
  }
  return parts.join('');
}

export function spendMapOption(
  map: SpendMap,
  tokens: MapTokens,
  opts: { compare: boolean; animate: boolean; /** Changes when the hidden set changes: the map starts from the top. */ hiddenKey?: string },
): EChartsOption {
  const compared = opts.compare && map.compared;
  const data: TileDatum[] = map.groups.map((g) => {
    const groupChange = g.previousCents > 0 ? Math.round(((g.valueCents - g.previousCents) / g.previousCents) * 100) : null;
    return {
      name: g.name,
      value: g.valueCents,
      group: g,
      share: map.totalCents ? g.valueCents / map.totalCents : 0,
      itemStyle: { color: tokens.panel, borderColor: tokens.panel },
      groupChange,
      children: g.children.map((t) => ({
        name: t.name,
        value: t.valueCents,
        tile: t,
        share: t.share,
        itemStyle: { color: tileColor(t, tokens, compared) },
        children: t.merchants
          .filter((m) => m.cents > 0)
          .map((m) => ({
            name: m.name,
            value: m.cents,
            merchant: m,
            categoryName: t.name,
            share: map.totalCents ? m.cents / map.totalCents : 0,
            itemStyle: { color: tileColor({ changePct: m.changePct, color: t.color }, tokens, compared) },
          })),
      })),
    };
  });
  return {
    animation: opts.animate,
    animationDurationUpdate: opts.animate ? 300 : 0,
    // Default tooltip card, as on the other charts.
    tooltip: {
      formatter: (p: unknown) => tooltipHtml((p as { data: TileDatum }).data, compared),
    },
    series: [
      {
        type: 'treemap',
        id: `spending:${opts.hiddenKey ?? ''}`,
        name: 'All spending',
        data: data as never,
        roam: false,
        // A category (leaf root) still opens on click; a merchant tile has no link, so it does nothing
        // (zoomToNode would zoom into that one tile).
        nodeClick: 'link',
        // Groups and categories show at once; clicking a category opens its merchants.
        leafDepth: 2,
        width: '100%',
        bottom: 34,
        top: 0,
        breadcrumb: { show: true, bottom: 0, itemStyle: { color: tokens.panel, borderColor: tokens.muted, textStyle: { color: tokens.text } } },
        label: {
          show: true,
          color: tokens.text,
          fontSize: 12,
          // Name, then the amount in bold with room between them. `fitTreemapLabels` then fits
          // each label to its tile (on its side, or on one line) once the map is laid out.
          formatter: (p: unknown) => {
            const d = (p as { data: TileDatum }).data;
            const emoji = d.tile?.emoji ? `${d.tile.emoji} ` : '';
            return `{name|${emoji}${d.name}}\n{amount|${money(d.value)}}`;
          },
          position: 'inside',
          align: 'center',
          verticalAlign: 'middle',
          rich: {
            name: { fontSize: 12, lineHeight: 20, color: tokens.text, align: 'center' },
            amount: { fontSize: 13, lineHeight: 18, fontWeight: 'bold', color: tokens.text, align: 'center' },
          },
        },
        itemStyle: { borderColor: tokens.panel, borderWidth: 2, gapWidth: 2 },
        levels: [
          // The root: no frame of its own.
          { itemStyle: { borderWidth: 0, gapWidth: 6 }, upperLabel: { show: false } },
          // Groups: a labelled frame around their categories.
          {
            itemStyle: { borderColor: tokens.panel, borderWidth: 4, gapWidth: 2 },
            upperLabel: { show: true, height: 20, color: tokens.muted, fontSize: 11, fontWeight: 'bold', formatter: '{b}' },
          },
          // Categories: the colored tiles.
          { itemStyle: { borderColor: tokens.panel, borderWidth: 1, gapWidth: 1, borderRadius: 4 } },
          // Merchants, once a category is opened.
          { itemStyle: { borderColor: tokens.panel, borderWidth: 1, gapWidth: 1, borderRadius: 3 } },
        ],
      },
    ],
  };
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

interface ZrText {
  style: { text?: string };
  setStyle(s: Record<string, unknown>): void;
  beforeUpdate?: () => void;
  disableLabelLayout?: boolean;
  __sbOriginal?: { text: string; beforeUpdate?: () => void };
  __sbFit?: () => void;
  /** Tile size the label was last fitted for. */
  __sbSize?: string;
}
interface ZrRect {
  shape?: { width?: number; height?: number };
  getTextContent?(): ZrText | undefined;
  setTextConfig(c: Record<string, unknown>): void;
  markRedraw?(): void;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The name line's real width as ECharts draws it (12px sans-serif), with the "▶ " arrow and padding. */
function measureName(name: string): number {
  if (measureCtx === undefined) measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!measureCtx) return nameWidth(name);
  measureCtx.font = '12px sans-serif';
  return measureCtx.measureText(`▶ ${name}`).width + 12;
}

/**
 * After the treemap draws, fit every tile label to its tile per `labelPlan`. ECharts sizes labels
 * to the tile horizontally on each update, so a vertical label also gets an update hook that sizes
 * it along the tile's height. Works on ECharts internals (zrender elements); harmless if absent.
 */
export function fitTreemapLabels(chart: unknown): void {
  const c = chart as {
    getModel?(): { getSeriesByIndex(i: number): unknown } | undefined;
    getViewOfSeriesModel?(m: unknown): { group: { traverse(fn: (el: ZrRect) => void): void } } | undefined;
  };
  const series = c.getModel?.()?.getSeriesByIndex(0);
  const view = series ? c.getViewOfSeriesModel?.(series) : undefined;
  if (!view) return;
  view.group.traverse((el) => {
    const text = el.getTextContent?.();
    const w = el.shape?.width;
    const h = el.shape?.height;
    if (!text || text.disableLabelLayout || w == null || h == null) return;
    const size = `${w}x${h}`;
    const ours = !!text.__sbFit && text.beforeUpdate === text.__sbFit;
    // Already fitted for this size since ECharts last drew it: nothing to do (and no redraw,
    // so no loop). A resize (full window) without a redraw refits from the saved original.
    if (ours && text.__sbSize === size) return;
    // Otherwise ECharts re-set the text and its update hook: start from what it set.
    const original = ours && text.__sbOriginal ? text.__sbOriginal : (text.__sbOriginal = { text: text.style.text ?? '', beforeUpdate: text.beforeUpdate });
    text.__sbSize = size;
    const nameMatch = /\{name\|([^}]*)\}/.exec(original.text);
    const amountMatch = /\{amount\|([^}]*)\}/.exec(original.text);
    if (!nameMatch) return;
    const prefix = original.text.slice(0, original.text.indexOf('{name|'));
    const plan = labelPlan(w, h, nameMatch[1], measureName);
    const nameOnly = `${prefix}{name|${nameMatch[1]}}`;
    const oneLine = amountMatch ? `${nameOnly}  {amount|${amountMatch[1]}}` : nameOnly;
    const textFor: Record<LabelPlan, string> = { full: original.text, inline: oneLine, name: nameOnly, vertical: original.text, verticalName: nameOnly, squeezed: original.text };
    text.setStyle({ text: textFor[plan] });
    const vertical = plan === 'vertical' || plan === 'verticalName';
    el.setTextConfig({ rotation: vertical ? Math.PI / 2 : 0 });
    const base = original.beforeUpdate;
    text.__sbFit = function fit(this: ZrText) {
      base?.call(this);
      if (plan === 'squeezed') return; // ECharts' own box: it truncates what doesn't fit
      // The label fits: drop the tile-sized box so it centres in the tile; a vertical one runs
      // along the tile's height.
      this.setStyle(vertical ? { width: Math.max(h - 8, 0), height: null } : { height: null });
    };
    text.beforeUpdate = text.__sbFit;
    el.markRedraw?.();
  });
}
