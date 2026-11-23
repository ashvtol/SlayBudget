import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { withGroupColors } from '@/lib/category-colors';
import { useTagsStore } from '@/lib/stores/tags-store';
import type { Category, DuplicateResolution, Recurring, Source, Transaction, TransactionFilter, TxType } from '@/lib/types';
import { clearAllPatch, removePillPatch, togglePatch, type FilterPill, type FilterValue } from './filter-model';

/** List order: by date (newest/oldest) or by size of amount (no day grouping). */
export type TxSort = 'newest' | 'oldest' | 'amountDesc' | 'amountAsc';

interface TransactionsState {
  transactions: Transaction[];
  categoriesById: Record<number, Category>;
  /** Saved recurring bills by id, for the R badge's name and the detail panel. */
  recurringsById: Record<number, Recurring>;
  sourcesById: Record<number, Source>;
  selected: Set<number>;
  cursor: number;
  loading: boolean;
  filter: TransactionFilter;

  sort: TxSort;
  load(profileId: number | null, filter?: Partial<TransactionFilter>): Promise<void>;
  applyFilter(patch: Partial<TransactionFilter>): Promise<void>;
  clearFilter(keys: (keyof TransactionFilter)[]): Promise<void>;
  /** Filter menu and pills: computed from the latest filter, so quick clicks don't undo each other. */
  toggleFilter(v: FilterValue): Promise<void>;
  removePill(pill: FilterPill): Promise<void>;
  clearAllFilters(): Promise<void>;
  setSort(sort: TxSort): void;
  /** Re-read data in the background keeping filter and the cursor's row (screen shown again). */
  refresh(): Promise<void>;
  orderedTransactions(): Transaction[];
  byId(id: number): Transaction | undefined;
  focusById(id: number): Promise<void>;
  /** The row another screen asked to show (a notification, say); the page opens it in the detail panel and clears it. */
  focused: number | null;
  /** A manual change: teaches the merchant and opens the "apply to others" offer. */
  setCategory(id: number, categoryId: number): Promise<void>;
  offer: { transactionId: number; categoryId: number } | null;
  /** Result of the last bulk apply, shown under the category. */
  notice: string | null;
  /** Close the offer; when transactions moved, reload and say how many. */
  closeOffer(moved: number | null): Promise<void>;
  setNotes(id: number, notes: string): Promise<void>;
  /** Change the type of transactions (categories that don't fit are cleared), then reload. */
  setType(ids: number[], type: TxType): Promise<void>;
  toggleReviewed(ids: number[]): Promise<void>;
  /** Delete transactions (a backup is made first), drop them from the selection, and reload. */
  deleteTransactions(ids: number[]): Promise<void>;
  /** Settle a possible duplicate (delete this one, delete the other one, or keep both), then reload. */
  resolveDuplicate(flagId: number, resolution: DuplicateResolution): Promise<void>;
  /** Copilot's tag checkbox: removes the tag when every row has it, otherwise adds it to all. */
  toggleTag(ids: number[], tagId: number): Promise<void>;
  /** Make a tag and put it on the rows; returns its id. */
  createTag(ids: number[], name: string): Promise<number>;
  toggleSelect(id: number): void;
  clearSelection(): void;
  setCursor(index: number): void;
  moveCursor(delta: number): void;
  cursorId(): number | null;
  unreviewedCount(): number;
}

let loadSeq = 0;

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  categoriesById: {},
  recurringsById: {},
  focused: null,
  sourcesById: {},
  selected: new Set(),
  cursor: 0,
  loading: false,
  filter: {},
  sort: 'newest',
  offer: null,
  notice: null,

  async load(profileId, filter) {
    // The filter takes effect now, so a second change builds on it; only the newest load lands.
    const seq = ++loadSeq;
    set({ loading: true, filter: { profileId, ...filter } });
    const [rawCategories, sources, groups, recurrings] = await Promise.all([
      ipc().listCategories(),
      ipc().listSources(),
      ipc().listCategoryGroups(),
      ipc().listRecurring(null),
      useTagsStore.getState().load(),
    ]);
    const f: TransactionFilter = { profileId, ...filter };
    // A category filter may point at a category deleted since: drop those ids.
    if (f.categoryIds?.length) {
      const known = new Set(rawCategories.map((c) => c.id));
      f.categoryIds = f.categoryIds.filter((id) => known.has(id));
      if (f.categoryIds.length === 0) delete f.categoryIds;
    }
    // Likewise a tag filter may point at a deleted tag.
    if (f.tagIds?.length) {
      const known = useTagsStore.getState().byId;
      f.tagIds = f.tagIds.filter((id) => known[id]);
      if (f.tagIds.length === 0) delete f.tagIds;
    }
    if (seq !== loadSeq) return;
    const transactions = await ipc().listTransactions(f);
    if (seq !== loadSeq) return;
    const categories = withGroupColors(rawCategories, groups);
    const categoriesById: Record<number, Category> = {};
    for (const c of categories) categoriesById[c.id] = c;
    const sourcesById: Record<number, Source> = {};
    for (const s of sources) sourcesById[s.id] = s;
    const recurringsById: Record<number, Recurring> = {};
    for (const r of recurrings) if (r.saved) recurringsById[r.saved.id] = r;
    set({ transactions, categoriesById, sourcesById, recurringsById, filter: f, loading: false, cursor: 0 });
  },

  async applyFilter(patch) {
    const next = { ...get().filter, ...patch };
    await get().load(next.profileId ?? null, next);
  },

  toggleFilter(v) {
    return get().applyFilter(togglePatch(get().filter, v));
  },

  removePill(pill) {
    return get().applyFilter(removePillPatch(get().filter, pill));
  },

  clearAllFilters() {
    return get().applyFilter(clearAllPatch());
  },

  async clearFilter(keys) {
    const next = { ...get().filter };
    for (const k of keys) delete next[k];
    await get().load(next.profileId ?? null, next);
  },

  async refresh() {
    if (get().loading) return;
    const keep = get().cursorId();
    const { profileId, ...rest } = get().filter;
    await get().load(profileId ?? null, rest);
    if (keep != null) {
      const idx = get().orderedTransactions().findIndex((t) => t.id === keep);
      if (idx >= 0) set({ cursor: idx });
    }
  },

  setSort(sort) {
    set({ sort, cursor: 0 });
  },

  orderedTransactions() {
    const { transactions, sort } = get();
    if (sort === 'newest') return transactions;
    if (sort === 'oldest') return [...transactions].reverse();
    const sign = sort === 'amountDesc' ? -1 : 1;
    // Stable: equal amounts keep date order.
    return [...transactions].sort((a, b) => sign * (Math.abs(a.amountCents) - Math.abs(b.amountCents)));
  },

  byId(id) {
    return get().transactions.find((t) => t.id === id);
  },

  async focusById(id) {
    const locate = () => get().orderedTransactions().findIndex((t) => t.id === id);
    if (locate() === -1) {
      // The row may be filtered out; drop filters so it can be shown.
      await get().applyFilter(clearAllPatch());
    }
    const idx = locate();
    if (idx >= 0) {
      get().setCursor(idx);
      set({ focused: id });
    }
  },

  async setCategory(id, categoryId) {
    await ipc().setTransactionCategory(id, categoryId);
    set((s) => ({
      transactions: s.transactions.map((t) => (t.id === id ? { ...t, categoryId, reviewed: true } : t)),
      offer: { transactionId: id, categoryId },
      notice: null,
    }));
  },

  async closeOffer(moved) {
    const offer = get().offer;
    set({ offer: null, notice: null });
    if (!offer || !moved) return;
    await get().applyFilter({});
    const name = get().categoriesById[offer.categoryId]?.name ?? 'the category';
    set({ notice: `Moved ${moved} ${moved === 1 ? 'transaction' : 'transactions'} to ${name}.` });
  },

  async setType(ids, type) {
    await ipc().setTransactionType(ids, type);
    await get().applyFilter({});
  },

  async setNotes(id, notes) {
    await ipc().updateTransaction(id, { notes: notes.trim() || null });
    set((s) => ({
      transactions: s.transactions.map((t) => (t.id === id ? { ...t, notes: notes.trim() || null } : t)),
    }));
  },

  async toggleReviewed(ids) {
    const target = new Set(ids);
    const anyUnreviewed = get().transactions.some((t) => target.has(t.id) && !t.reviewed);
    await ipc().bulkUpdateTransactions(ids, { reviewed: anyUnreviewed });
    set((s) => ({
      transactions: s.transactions.map((t) => (target.has(t.id) ? { ...t, reviewed: anyUnreviewed } : t)),
    }));
  },

  async deleteTransactions(ids) {
    if (ids.length === 0) return;
    await ipc().deleteTransactions(ids);
    const gone = new Set(ids);
    set((s) => ({ selected: new Set([...s.selected].filter((id) => !gone.has(id))) }));
    await get().refresh();
  },

  async resolveDuplicate(flagId, resolution) {
    await ipc().resolveDuplicate(flagId, resolution);
    await get().refresh();
    await useTagsStore.getState().load();
  },

  async toggleTag(ids, tagId) {
    const target = new Set(ids);
    const rows = get().transactions.filter((t) => target.has(t.id));
    const allHave = rows.length > 0 && rows.every((t) => t.tagIds?.includes(tagId));
    if (allHave) await ipc().removeTags(ids, [tagId]);
    else await ipc().addTags(ids, [tagId]);
    set((s) => ({
      transactions: s.transactions.map((t) => {
        if (!target.has(t.id)) return t;
        const rest = (t.tagIds ?? []).filter((g) => g !== tagId);
        return { ...t, tagIds: allHave ? rest : [...rest, tagId].sort((a, b) => a - b) };
      }),
    }));
    await useTagsStore.getState().load();
  },

  async createTag(ids, name) {
    const id = await useTagsStore.getState().create(name);
    await get().toggleTag(ids, id);
    return id;
  },

  toggleSelect(id) {
    set((s) => {
      const selected = new Set(s.selected);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { selected };
    });
  },

  clearSelection() {
    set({ selected: new Set() });
  },

  setCursor(index) {
    const max = Math.max(0, get().transactions.length - 1);
    set({ cursor: Math.min(Math.max(0, index), max) });
  },

  moveCursor(delta) {
    get().setCursor(get().cursor + delta);
  },

  cursorId() {
    return get().orderedTransactions()[get().cursor]?.id ?? null;
  },

  unreviewedCount() {
    return get().transactions.filter((t) => !t.reviewed).length;
  },
}));
