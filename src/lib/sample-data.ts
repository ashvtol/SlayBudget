import { DUPLICATE_TAG_COLOR, DUPLICATE_TAG_NAME } from './duplicates-memory';
import { money } from './notification-producers';
// Sample dataset for the browser build (no Tauri, no real data). It gives every
// screen realistic content so the UI can be developed and compared visually.
// Deterministic: the same `today` always yields the same data.

import type { MemoryIpcSeed } from './ipc';
import type { Category, CategoryGroup, Source, Transaction } from './types';

const GROUPS: CategoryGroup[] = [
  { id: 1, name: 'Home', emoji: '🏠', color: '#4c85ee', sortOrder: 0 },
  { id: 2, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 1 },
  { id: 3, name: 'Shopping', emoji: '🛍️', color: '#bb45f3', sortOrder: 2 },
  { id: 4, name: 'Transportation', emoji: '🚗', color: '#e8c34f', sortOrder: 3 },
  { id: 5, name: 'Entertainment', emoji: '🎟️', color: '#e34e3a', sortOrder: 4 },
  { id: 6, name: 'Self Care', emoji: '💆', color: '#d9b44a', sortOrder: 5 },
  { id: 7, name: 'Subscriptions', emoji: '📺', color: '#8b97ad', sortOrder: 6 },
  { id: 8, name: 'Pet', emoji: '🐶', color: '#57bd57', sortOrder: 7 },
  { id: 9, name: 'Income', emoji: '💰', color: '#57bd57', sortOrder: 8 },
  { id: 10, name: 'Transfers', emoji: '🔁', color: '#617598', sortOrder: 9 },
];

type Kind = Category['kind'];
const cat = (id: number, groupId: number, name: string, emoji: string, budget: number | null, kind: Kind = 'expense', excluded = false): Category => ({
  id, groupId, name, emoji, color: GROUPS.find((g) => g.id === groupId)?.color ?? null, budgetCents: budget, excluded, kind, sortOrder: id, archived: false,
});

const CATEGORIES: Category[] = [
  cat(101, 1, 'Rent', '🏡', 220000),
  cat(102, 1, 'Phone', '📱', 9000),
  cat(103, 1, 'Electric', '💡', 9000),
  cat(104, 1, 'Internet', '🛜', 6000),
  cat(201, 2, 'Restaurants', '🍔', 40000),
  cat(202, 2, 'Groceries', '🥑', 45000),
  cat(203, 2, 'Coffee', '☕', 6000),
  cat(301, 3, 'Shopping', '🛍️', 50000),
  cat(401, 4, 'Car Insurance', '🚙', 10000),
  cat(402, 4, 'Rideshare', '🚕', 10000),
  cat(403, 4, 'Gas', '⛽', 12000),
  cat(501, 5, 'Entertainment', '🎟️', 20000),
  cat(601, 6, 'Personal Care', '🧴', 10000),
  cat(602, 6, 'Gym', '💪', 6000),
  cat(701, 7, 'Streaming', '🍿', 4500),
  cat(702, 7, 'Music', '🎧', 1200),
  cat(801, 8, 'Pet', '🐾', 10000),
  cat(901, 9, 'Paycheck', '💵', null, 'income'),
  cat(902, 9, 'Interest', '🏦', null, 'income'),
  cat(1001, 10, 'Card Payment', '💳', null, 'transfer', true),
];

const SOURCES: Source[] = [
  { id: 1, profileId: 1, name: 'Amex Gold', kind: 'csv', institution: 'American Express', currency: 'USD' },
  { id: 2, profileId: 1, name: 'Citi Costco', kind: 'csv', institution: 'Citi', currency: 'USD' },
  { id: 3, profileId: 1, name: 'Citi Checking', kind: 'pdf', institution: 'Citi', currency: 'USD' },
];

// [merchant, categoryId, min cents, max cents, source, relative weight]
const DAILY: [string, number, number, number, number, number][] = [
  ['Marinara Pizza', 201, 1400, 3200, 1, 3],
  ['Sweetgreen', 201, 1300, 2100, 1, 3],
  ['Shake Shack', 201, 1500, 3800, 1, 2],
  ['Jamba Juice', 201, 800, 1400, 1, 1],
  ['Whole Foods', 202, 2500, 9500, 2, 3],
  ['Trader Joes', 202, 2200, 7800, 2, 3],
  ['Costco', 202, 6000, 21000, 2, 1],
  ['Blue Bottle', 203, 450, 900, 1, 4],
  ['Target', 301, 1800, 9000, 2, 2],
  ['Amazon', 301, 1200, 12000, 2, 3],
  ['Apple Store', 301, 1500, 6000, 1, 1],
  ['Uber', 402, 1100, 3400, 1, 2],
  ['Shell', 403, 3500, 6200, 2, 2],
  ['AMC Theatres', 501, 1800, 4200, 1, 1],
  ['Ticketmaster', 501, 4000, 15000, 1, 1],
  ['CVS', 601, 800, 3500, 2, 2],
  ['Walgreens', 601, 600, 2400, 2, 1],
  ['Petco', 801, 2000, 7500, 2, 1],
];

// [merchant, categoryId, day of month, cents (negative = out), source, wobble cents]
const MONTHLY: [string, number, number, number, number, number][] = [
  ['Rent', 101, 1, -220000, 3, 0],
  ['Spotify', 702, 1, -1199, 1, 0],
  ['State Farm', 401, 2, -10000, 3, 0],
  ['Con Edison', 103, 3, -7500, 3, 1800],
  ['Equinox', 602, 5, -5500, 1, 0],
  ['Verizon', 102, 8, -9000, 1, 0],
  ['Netflix', 701, 15, -1799, 1, 0],
  ['Hulu', 701, 9, -1199, 1, 0],
  ['Spectrum', 104, 16, -6000, 3, 0],
  // Paid back by the card two days later: Recurrings asks "Do they pay it back?".
  ['Walmart+', 301, 22, -1295, 1, 0],
  ['Amex Walmart+ Credit', 301, 24, 1295, 1, 0],
  // Renamed on the statement halfway through (below): Recurrings suggests merging HBO Max and Max.
  ['HBO Max', 701, 12, -1599, 1, 0],
  ['Paycheck', 901, 1, 395000, 3, 0],
  ['Paycheck', 901, 15, 395000, 3, 0],
  ['Interest Payment', 902, 28, 4200, 3, 600],
  ['Amex Payment', 1001, 20, -185000, 3, 25000],
];

/** Small seeded PRNG (mulberry32) so the data is stable between reloads. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const KIND_TYPE = { expense: 'regular', income: 'income', transfer: 'transfer' } as const;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function sampleSeed(today: Date = new Date()): MemoryIpcSeed {
  const rand = rng(20261121);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end.getFullYear(), end.getMonth() - 13, 1);
  const reviewCutoff = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 3);
  const totalWeight = DAILY.reduce((s, m) => s + m[5], 0);
  const txs: Transaction[] = [];

  const push = (day: Date, merchant: string, categoryId: number | null, cents: number, sourceId: number) => {
    txs.push({
      id: txs.length + 1,
      profileId: 1,
      sourceId,
      postedOn: iso(day),
      description: `${merchant.toUpperCase()} ${sourceId === 3 ? 'ACH' : 'POS'}`,
      merchant,
      amountCents: cents,
      currency: 'USD',
      categoryId,
      // A row takes its category's type, as imports do.
      txType: KIND_TYPE[CATEGORIES.find((c) => c.id === categoryId)?.kind ?? 'expense'],
      categoryLocked: false,
      reviewed: day < reviewCutoff,
      notes: null,
      refundOf: null,
    });
  };

  const pickDaily = () => {
    let r = rand() * totalWeight;
    for (const m of DAILY) {
      r -= m[5];
      if (r <= 0) return m;
    }
    return DAILY[0];
  };

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    for (const [merchant, categoryId, dom, cents, source, wobble] of MONTHLY) {
      if (d.getDate() !== dom) continue;
      const w = wobble ? Math.round((rand() - 0.5) * 2 * wobble) : 0;
      push(d, merchant, categoryId, cents + w, source);
    }
    const isToday = d.getTime() === end.getTime();
    const count = Math.max(isToday ? 1 : 0, Math.floor(rand() * 3.2));
    for (let i = 0; i < count; i++) {
      const [merchant, categoryId, min, max, source] = pickDaily();
      const cents = -Math.round(min + rand() * (max - min));
      // A few recent ones arrive uncategorized so "needs category" shows up.
      const uncategorized = d >= reviewCutoff && rand() < 0.2;
      push(d, merchant, uncategorized ? null : categoryId, cents, source);
    }
  }

  // HBO Max became Max six months ago: the same subscription under a new statement name.
  const renamedOn = iso(new Date(end.getFullYear(), end.getMonth() - 5, 1));
  for (const t of txs) {
    if (t.merchant === 'HBO Max' && t.postedOn >= renamedOn) {
      t.merchant = 'Max';
      t.description = t.description.replace('HBO MAX', 'MAX');
    }
  }

  // Equinox moved to a pricier membership this month, so Recurrings asks "Is this Equinox at a new price?".
  const lastEquinox = txs.filter((t) => t.merchant === 'Equinox').at(-1);
  if (lastEquinox) lastEquinox.amountCents = -8900;

  // Smart categorization: each uncategorized row has a suggestion from the merchant's usual category, and the latest
  // Blue Bottle was categorized by the classifier, which says why.
  const usual = new Map(DAILY.map((m) => [m[0], m[1]]));
  const nameOf = (id: number) => CATEGORIES.find((c) => c.id === id)?.name ?? '';
  const yours = (merchant: string, categoryId: number) => txs.filter((t) => t.merchant === merchant && t.categoryId === categoryId && t.reviewed).length;
  for (const t of txs) {
    const c = t.categoryId == null ? usual.get(t.merchant) : undefined;
    if (c == null) continue;
    t.suggestedCategoryId = c;
    t.suggestedReason = `Like ${yours(t.merchant, c)} others you put in ${nameOf(c)} (${t.merchant})`;
  }
  const coffee = txs.filter((t) => t.merchant === 'Blue Bottle' && t.categoryId === 203).at(-1);
  if (coffee) {
    coffee.categorySource = 'model';
    coffee.categoryReason = `Like ${yours('Blue Bottle', 203) - (coffee.reviewed ? 1 : 0)} others you put in Coffee (Blue Bottle)`;
  }

  // Two slips from overlapping statements, flagged as possible duplicates: the PDF's wording, and a tip added later.
  const tag = { id: 1, name: DUPLICATE_TAG_NAME, color: DUPLICATE_TAG_COLOR };
  const duplicateFlags: NonNullable<MemoryIpcSeed['duplicateFlags']> = [];
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const bill = new Set(MONTHLY.map((m) => m[0]));
  const recentCharges = txs
    .filter((t) => t.sourceId === 1 && t.amountCents < -1500 && t.postedOn < iso(reviewCutoff) && !bill.has(t.merchant))
    .slice(-2);
  recentCharges.forEach((orig, i) => {
    const copy: Transaction = {
      ...orig,
      id: txs.length + 1,
      reviewed: false,
      tagIds: [tag.id],
      ...(i === 0
        ? { description: `${orig.description} #0193 SEATTLE WA` }
        : { postedOn: iso(new Date(new Date(`${orig.postedOn}T00:00:00`).getTime() + 86_400_000)), amountCents: orig.amountCents - 600 }),
    };
    txs.push(copy);
    duplicateFlags.push({
      id: i + 1,
      txId: copy.id,
      otherId: orig.id,
      importId: null,
      confidence: i === 0 ? 'certain' : 'likely',
      reason:
        i === 0
          ? `Same day and amount as ${orig.description} (${money(-orig.amountCents)}, Amex Gold, imported ${short(iso(end))}), worded differently.`
          : `Same place a day apart as ${orig.description} on ${short(orig.postedOn)} (${money(-orig.amountCents)}); the amount changed by $6.00 (a tip?).`,
      createdAt: `${iso(end)}T09:00:00Z`,
      resolvedAt: null,
      resolution: null,
    });
  });

  // The last three months arrive as one statement per account, so Import shows Recent imports.
  const imports: NonNullable<MemoryIpcSeed['imports']> = [];
  for (let back = 3; back >= 1; back--) {
    const month = new Date(end.getFullYear(), end.getMonth() - back + 1, 1);
    const key = iso(month).slice(0, 7);
    for (const src of SOURCES) {
      const ids = txs.filter((t) => t.sourceId === src.id && t.postedOn.startsWith(key)).map((t) => t.id);
      if (ids.length === 0) continue;
      imports.push({
        id: imports.length + 1,
        sourceId: src.id,
        sourceName: src.name,
        fileName: `${src.name.replace(/\s+/g, '-')}-${key}.csv`,
        importedAt: `${iso(back === 1 ? end : new Date(month.getFullYear(), month.getMonth() + 1, 2))}T09:00:00Z`,
        importedRows: ids.length,
        skippedRows: 0,
        transactionIds: ids,
      });
    }
  }

  // Each flagged copy came in with its month's statement.
  for (const f of duplicateFlags) f.importId = imports.find((im) => im.transactionIds.includes(f.txId!))?.id ?? null;

  return {
    imports,
    tags: [tag],
    duplicateFlags,
    profiles: [{ id: 1, name: 'Me', color: '#77a5f2', sortOrder: 0 }],
    sources: SOURCES.map((s) => ({ ...s })),
    groups: GROUPS.map((g) => ({ ...g })),
    categories: CATEGORIES.map((c) => ({ ...c })),
    transactions: txs,
  };
}
