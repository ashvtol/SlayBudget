// The Insights spending map, laid out with d3-hierarchy (what visx's treemap uses): group frames with their name on top,
// category tiles colored by change against the previous period, and a category's merchants once you open it. Tiles are
// absolutely positioned boxes so they glide to new places when the data changes (not with Reduce motion); hovering a
// tile shows a dark card that follows the pointer at once.

import { useEffect, useState, type PointerEvent } from 'react';
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { formatMoney } from '@/lib/format';
import { displayCurrency } from '@/features/currency/currency-store';
import { labelPlan, tileColor, type MapTokens, type MerchantTile, type SpendGroup, type SpendMap, type SpendTile } from '@/features/analytics/spend-map';
import { prefersReducedMotion, readChartTokens } from '../tokens';
import { useMeasuredWidth } from './bar-chart';

export interface MapTile {
  key: string;
  level: 'group' | 'category' | 'merchant';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  valueCents: number;
  group?: SpendGroup;
  tile?: SpendTile;
  merchant?: MerchantTile;
  /** For a merchant: the category it's in. */
  category?: SpendTile;
}

const GROUP_HEADER = 20;
const CARD_WIDTH = 260;

interface Datum {
  value?: number;
  group?: SpendGroup;
  tile?: SpendTile;
  merchant?: MerchantTile;
  children?: Datum[];
}

const focusKey = (t: SpendTile) => `${t.groupName}/${t.name}`;

/** Where every tile goes for this size: groups and their categories, or the opened category's merchants. */
export function layoutSpendMap(map: SpendMap, opts: { width: number; height: number; focus: string | null }): MapTile[] {
  const focused = opts.focus ? map.groups.flatMap((g) => g.children).find((t) => focusKey(t) === opts.focus) : undefined;
  const data: Datum = focused
    ? { children: focused.merchants.filter((m) => m.cents > 0).map((m) => ({ merchant: m, value: m.cents })) }
    : {
        children: map.groups.map((g) => ({
          group: g,
          children: g.children.filter((t) => t.valueCents > 0).map((t) => ({ tile: t, value: t.valueCents })),
        })),
      };
  const root = hierarchy<Datum>(data).sum((d) => d.value ?? 0);
  const laid: HierarchyRectangularNode<Datum> = treemap<Datum>()
    .tile(treemapSquarify)
    .size([Math.max(0, opts.width), Math.max(0, opts.height)])
    .paddingInner((n) => (n.depth === 0 ? (focused ? 2 : 6) : 2))
    .paddingTop((n) => (n.depth === 1 && !focused ? GROUP_HEADER : 0))(root);
  return laid
    .descendants()
    .filter((n) => n.depth > 0)
    .map((n) => {
      const d = n.data;
      const box = { x: n.x0, y: n.y0, w: n.x1 - n.x0, h: n.y1 - n.y0, valueCents: n.value ?? 0 };
      if (d.merchant) return { key: `m:${opts.focus}/${d.merchant.name}`, level: 'merchant', name: d.merchant.name, merchant: d.merchant, category: focused, ...box };
      if (d.group) return { key: `g:${d.group.name}`, level: 'group', name: d.group.name, group: d.group, ...box };
      return { key: `c:${focusKey(d.tile!)}`, level: 'category', name: d.tile!.name, tile: d.tile, ...box };
    });
}

const money = (cents: number) => formatMoney(cents, displayCurrency());
const signed = (cents: number) => `${cents >= 0 ? '+' : '−'}${money(cents)}`;
const change = (now: number, before: number) => `${signed(now - before)} (${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%)`;

export function SpendTreemap({
  map,
  compared,
  height,
  width,
  tokens = readChartTokens(),
}: {
  map: SpendMap;
  /** Whether colors show change against the previous period (else category colors). */
  compared: boolean;
  height: number;
  width?: number;
  tokens?: MapTokens;
}) {
  const [ref, w] = useMeasuredWidth(width);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<{ tile: MapTile; x: number; y: number } | null>(null);
  const tiles = layoutSpendMap(map, { width: w, height, focus });
  const focused = focus ? tiles.find((t) => t.level === 'merchant')?.category : undefined;
  // Tiles glide when the data changes; on first draw and when the map is resized they're placed at once (gliding
  // switches on a frame after the map has settled at its size).
  const size = `${w}x${height}`;
  const [settledAt, setSettledAt] = useState<string | null>(null);
  const [sizeSeen, setSizeSeen] = useState(size);
  if (sizeSeen !== size) {
    setSizeSeen(size);
    setSettledAt(null);
  }
  useEffect(() => {
    if (settledAt === size) return;
    const frame = requestAnimationFrame(() => setSettledAt(size));
    return () => cancelAnimationFrame(frame);
  }, [settledAt, size]);
  const glide = prefersReducedMotion() || settledAt !== size ? undefined : 'left 300ms ease, top 300ms ease, width 300ms ease, height 300ms ease';
  const open = (t: MapTile) => {
    if (t.tile && t.tile.merchants.some((m) => m.cents > 0)) {
      setFocus(focusKey(t.tile));
      setHover(null);
    }
  };
  const track = (t: MapTile) => (e: PointerEvent<HTMLElement>) => {
    const box = (ref.current as HTMLElement).getBoundingClientRect();
    setHover({ tile: t, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  return (
    <div>
      <nav aria-label="Spending map path" className="mb-2 flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
        {focus ? (
          <button type="button" onClick={() => setFocus(null)} className="font-semibold" style={{ color: 'var(--accent)' }}>
            All spending
          </button>
        ) : (
          <span>All spending</span>
        )}
        {focused && (
          <>
            <span aria-hidden>›</span>
            <span style={{ color: 'var(--text)' }}>{focused.name}</span>
          </>
        )}
      </nav>
      <div
        ref={ref}
        role="group"
        aria-label="Spending map: tiles sized by spending, colored by change against the previous period"
        className="relative overflow-hidden"
        style={{ height }}
        onPointerLeave={() => setHover(null)}
      >
        {tiles.map((t) => {
          const pos = { left: t.x, top: t.y, width: t.w, height: t.h, transition: glide };
          if (t.level === 'group') {
            return (
              <div key={t.key} className="pointer-events-none absolute" style={pos}>
                <div className="truncate px-1 text-[11px] font-bold leading-[18px]" style={{ color: 'var(--muted)' }}>
                  {t.name}
                </div>
              </div>
            );
          }
          const source = t.tile ?? { changePct: t.merchant!.changePct, color: t.category!.color };
          const label = `${t.tile?.emoji ? `${t.tile.emoji} ` : ''}${t.name}`;
          const common = {
            className: 'absolute flex items-center justify-center overflow-hidden rounded text-center outline-none focus-visible:[outline:2px_solid_var(--accent)]',
            style: { ...pos, background: tileColor(source, tokens, compared), color: 'var(--text)' },
            onPointerMove: track(t),
          };
          return t.level === 'category' ? (
            <div
              key={t.key}
              role="button"
              tabIndex={0}
              aria-label={`${label}, ${money(t.valueCents)}`}
              {...common}
              style={{ ...common.style, cursor: 'pointer' }}
              onClick={() => open(t)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(t);
                }
              }}
            >
              <TileLabel name={label} amount={money(t.valueCents)} w={t.w} h={t.h} />
            </div>
          ) : (
            <div key={t.key} {...common}>
              <TileLabel name={label} amount={money(t.valueCents)} w={t.w} h={t.h} />
            </div>
          );
        })}
        {hover && <MapCard tile={hover.tile} map={map} compared={compared} x={hover.x} y={hover.y} width={w} />}
      </div>
    </div>
  );
}

/** The tile's label, fitted to it: name over amount, on one line, just the name, on its side, or truncated. */
function TileLabel({ name, amount, w, h }: { name: string; amount: string; w: number; h: number }) {
  const plan = labelPlan(w, h, name);
  const nameEl = <span className="truncate text-[12px]">{name}</span>;
  const amountEl = <span className="text-[13px] font-bold tabular-nums">{amount}</span>;
  switch (plan) {
    case 'full':
      return (
        <span className="flex min-w-0 flex-col items-center gap-1 px-1">
          {nameEl}
          {amountEl}
        </span>
      );
    case 'inline':
      return (
        <span className="flex min-w-0 items-center gap-2 px-1">
          {nameEl}
          {amountEl}
        </span>
      );
    case 'name':
      return <span className="min-w-0 px-1">{nameEl}</span>;
    case 'vertical':
    case 'verticalName':
      return (
        <span className="flex items-center gap-1 text-[12px]" style={{ writingMode: 'vertical-rl' }}>
          <span className="truncate">{name}</span>
          {plan === 'vertical' && <span className="font-bold">{amount}</span>}
        </span>
      );
    default:
      return <span className="block w-full truncate px-0.5 text-[10px]">{name}</span>;
  }
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      {color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />}
      <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--muted)' }}>{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </div>
  );
}

function MapCard({ tile, map, compared, x, y, width }: { tile: MapTile; map: SpendMap; compared: boolean; x: number; y: number; width: number }) {
  const left = x + 14 + CARD_WIDTH <= width ? x + 14 : Math.max(0, x - 14 - CARD_WIDTH);
  const share = map.totalCents ? tile.valueCents / map.totalCents : 0;
  const t = tile.tile;
  const m = tile.merchant;
  const before = t?.previousCents ?? m?.previousCents ?? 0;
  const title = m
    ? `${m.name} · ${tile.category?.name ?? ''}`
    : `${t?.emoji ? `${t.emoji} ` : ''}${tile.name}${t && t.groupName !== t.name ? ` · ${t.groupName}` : ''}`;
  return (
    <div
      data-testid="map-card"
      role="group"
      aria-label={title}
      className="pointer-events-none absolute z-20 flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-[12px] shadow-2xl"
      style={{ left, top: y + 14, width: CARD_WIDTH, background: 'var(--panel)', borderColor: 'var(--line-strong)' }}
    >
      <div className="mb-0.5 font-semibold">{title}</div>
      <Row label="Spent" value={money(tile.valueCents)} />
      <Row label="Share" value={`${(share * 100).toFixed(1)}%`} />
      {compared && <Row label="vs previous period" value={before > 0 ? change(tile.valueCents, before) : 'New'} />}
      {t && <Row label="Transactions" value={String(t.count)} />}
      {t && <Row label="Average" value={money(t.avgCents)} />}
      {m && <Row label="Visits" value={String(m.count)} />}
      {m && <Row label="Average" value={money(Math.round(m.cents / Math.max(1, m.count)))} />}
      {t?.topMerchants.filter((x) => x.cents > 0).map((x) => <Row key={x.name} label={x.name} value={money(x.cents)} color="var(--subtle)" />)}
    </div>
  );
}
