import type { Category, Source, TransactionFilter } from '@/lib/types';
import { sourceDotColors } from '@/lib/source-colors';
import { clearAllPatch, filterPills, isFiltered, monthLabel, monthsByYear, removePillPatch, togglePatch } from './filter-model';

const cat = (id: number, name: string, emoji: string | null, color: string | null): Category => ({
  id, groupId: 1, name, emoji, color, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const src = (id: number, name: string, institution: string | null): Source => ({ id, profileId: 1, name, kind: 'csv', institution, currency: 'USD' });

const categoriesById = { 3: cat(3, 'Restaurants', '🍔', '#e8743b'), 4: cat(4, 'Groceries', '🛒', null) };
const sources = [src(1, 'Amex Gold', 'American Express'), src(2, 'Citi Costco', 'Citi'), src(3, 'Citi Checking', 'Citi')];
const sourcesById = Object.fromEntries(sources.map((s) => [s.id, s]));

describe('togglePatch', () => {
  it('adds and removes list values per kind', () => {
    expect(togglePatch({}, { kind: 'category', value: 3 })).toEqual({ categoryIds: [3] });
    expect(togglePatch({ categoryIds: [3, 4] }, { kind: 'category', value: 3 })).toEqual({ categoryIds: [4] });
    expect(togglePatch({}, { kind: 'account', value: 2 })).toEqual({ sourceIds: [2] });
    expect(togglePatch({ months: ['2026-05'] }, { kind: 'month', value: '2026-06' })).toEqual({ months: ['2026-05', '2026-06'] });
    expect(togglePatch({ recurringIds: [7] }, { kind: 'recurring', value: 7 })).toEqual({ recurringIds: undefined });
    expect(togglePatch({}, { kind: 'recurring', value: 7 })).toEqual({ recurringIds: [7] });
    expect(togglePatch({ types: ['income'] }, { kind: 'type', value: 'transfer' })).toEqual({ types: ['income', 'transfer'] });
    expect(filterPills({ types: ['transfer'] }, { categoriesById: {}, sourcesById: {}, sourceColors: {} }).map((p) => p.label)).toEqual(['Internal transfer']);
    expect(isFiltered({ types: ['regular'] })).toBe(true);
  });

  it('sets single values, and picking the active one clears it', () => {
    expect(togglePatch({}, { kind: 'keyword', value: ' uber ' })).toEqual({ text: 'uber' });
    expect(togglePatch({}, { kind: 'review', value: false })).toEqual({ reviewed: false });
    expect(togglePatch({ reviewed: false }, { kind: 'review', value: true })).toEqual({ reviewed: true });
    expect(togglePatch({ reviewed: true }, { kind: 'review', value: true })).toEqual({ reviewed: undefined });
  });
});

describe('filterPills', () => {
  it('lists one pill per value with labels, emoji and colors', () => {
    const f: TransactionFilter = { categoryIds: [3], sourceIds: [2], months: ['2026-06'], recurringIds: [7], text: 'uber', reviewed: false };
    const pills = filterPills(f, { categoriesById, sourcesById, sourceColors: sourceDotColors(sources), recurringNames: { 7: 'Good To Go' } });
    expect(pills.map((p) => p.label)).toEqual(['Citi Costco', 'Restaurants', 'June 2026', '“uber”', 'Good To Go', 'Not reviewed']);
    expect(pills[1]).toMatchObject({ emoji: '🍔', color: '#e8743b' });
    expect(pills[0].dot).toBe(sourceDotColors(sources)[2]);
  });

  it('removing a pill clears just that value', () => {
    const f: TransactionFilter = { categoryIds: [3, 4], reviewed: true };
    const [restaurants, , reviewed] = filterPills(f, { categoriesById, sourcesById, sourceColors: {} });
    expect(removePillPatch(f, restaurants)).toEqual({ categoryIds: [4] });
    expect(reviewed.label).toBe('Reviewed');
    expect(removePillPatch(f, reviewed)).toEqual({ reviewed: undefined });
  });
});

describe('isFiltered and clearAllPatch', () => {
  it('ignores profile and paging', () => {
    expect(isFiltered({ profileId: 1, limit: 50, offset: 0 })).toBe(false);
    expect(isFiltered({ categoryIds: [] })).toBe(false);
    expect(isFiltered({ months: ['2026-06'] })).toBe(true);
    expect(isFiltered({ recurringIds: [1] })).toBe(true);
    expect(isFiltered({ text: 'x' })).toBe(true);
    expect(isFiltered({ reviewed: false })).toBe(true);
  });

  it('clears every filter kind', () => {
    const patch = clearAllPatch();
    const f = { ...{ categoryIds: [3], sourceIds: [1], months: ['2026-06'], merchants: ['x'], text: 'y', reviewed: true, from: '2026-01-01', to: '2026-02-01' }, ...patch };
    expect(isFiltered(f)).toBe(false);
  });
});

describe('months', () => {
  it('groups days with data by year, newest first', () => {
    expect(monthsByYear(['2025-12-30', '2026-06-01', '2026-06-20', '2026-01-02'])).toEqual([
      { year: '2026', months: ['2026-06', '2026-01'] },
      { year: '2025', months: ['2025-12'] },
    ]);
  });

  it('labels a month', () => {
    expect(monthLabel('2026-06')).toBe('June 2026');
  });
});

describe('sourceDotColors', () => {
  it('assigns dots in sidebar order (grouped by institution)', () => {
    const colors = sourceDotColors([src(1, 'A', 'Citi'), src(2, 'B', 'Amex'), src(3, 'C', 'Citi')]);
    expect(Object.keys(colors)).toHaveLength(3);
    // Citi's two sources come first, then Amex.
    const order = [colors[1], colors[3], colors[2]];
    expect(new Set(order).size).toBe(3);
    expect(colors[1]).toBe('#4c85ee');
    expect(colors[3]).toBe('#e34e3a');
  });
});

describe('tag filters', () => {
  it('toggles tags, counts as filtered, clears with all, and labels pills with the tag dot', () => {
    expect(togglePatch({}, { kind: 'tag', value: 4 })).toEqual({ tagIds: [4] });
    expect(togglePatch({ tagIds: [4] }, { kind: 'tag', value: 4 })).toEqual({ tagIds: undefined });
    expect(isFiltered({ tagIds: [4] })).toBe(true);
    expect(clearAllPatch()).toHaveProperty('tagIds', undefined);
    const pills = filterPills({ tagIds: [4, 9] }, { categoriesById: {}, sourcesById: {}, sourceColors: {}, tagsById: { 4: { id: 4, name: 'Work', color: '#4a8ef0', count: 1 } } });
    expect(pills.map((p) => [p.label, p.dot])).toEqual([['Work', '#4a8ef0'], ['Tag', undefined]]);
  });
});

describe('suggested filter', () => {
  it('toggles, counts as filtered, clears with all, and has a pill', () => {
    expect(togglePatch({}, { kind: 'suggested', value: true })).toEqual({ suggested: true });
    expect(togglePatch({ suggested: true }, { kind: 'suggested', value: true })).toEqual({ suggested: undefined });
    expect(isFiltered({ suggested: true })).toBe(true);
    expect(isFiltered({ suggested: true, ...clearAllPatch() })).toBe(false);
    const ctx = { categoriesById, sourcesById, sourceColors: {} };
    const [pill] = filterPills({ suggested: true }, ctx);
    expect(pill.label).toBe('Suggested category');
    expect(removePillPatch({ suggested: true }, pill)).toEqual({ suggested: undefined });
  });
});
