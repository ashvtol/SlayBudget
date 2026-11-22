/**
 * The boundary between the React app and the Rust core.
 * Components never call Tauri directly; they go through `ipc()` so tests can
 * swap in the in-memory implementation.
 */

import type { AppNotification, DuplicateFlag, DuplicateResolution, ImportRecord, NewNotification } from './types';
import { DUPLICATE_TAG_NAME, duplicatesBeforeDelete, openFlagFor, settle, stillFlagged } from './duplicates-memory';
import type {
  BudgetStatus,
  CashFlow,
  Category,
  CategoryGroup,
  CategoryPatch,
  CategoryMeta,
  CategoryTotal,
  FxRate,
  GroupTarget,
  MonthlyTotal,
  NewCategory,
  Profile,
  LegacyReport,
  Recurring,
  Source,
  ImportReport,
  PdfTextDto,
  SplitPart,
  TimeRange,
  Transaction,
  TransactionFilter,
  TransactionPatch,
  WatchScan,
  RecatTarget,
  RecatMatch,
  RuleInputDto,
  OtherGroup,
  FtProposal,
  FtChoice,
  FtReport,
  FtTarget,
  TxType,
  NewRecurring,
  SavedRecurring,
  MatchReport,
  RecurringStatus,
  BudgetPlan,
  RebalanceScope,
  StatementInfo,
  Tag,
  TagPatch,
} from './types';
import { createNotificationInbox } from './notifications-memory';
import { configFrom, KEY as NOTIFICATION_CONFIG_KEY, OLD_HORIZON_KEY } from './notification-config';
import { produceCandidates } from './notification-producers';

const BASELINED_KEY = 'notifications.baselined_at';
import { MIN_CONTAINS, isPaymentPlatform, normalizeDescription } from './recategorize';
import {
  budgetStatus,
  cashFlow,
  categoryTotals,
  detectRecurring,
  monthlyTotals,
  resolveRange,
} from './analytics';
import { parseQuery, runSearch } from './search';
import { normalizedName } from './category-names';
import { budgetsForMonth } from './budget-plan';

export type { Profile } from './types';

export interface Ipc {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  listProfiles(): Promise<Profile[]>;
  createProfile(name: string, color?: string | null): Promise<number>;
  renameProfile(id: number, name: string): Promise<void>;
  deleteProfile(id: number): Promise<void>;
  listSources(): Promise<Source[]>;

  listTransactions(filter: TransactionFilter): Promise<Transaction[]>;
  countTransactions(filter: TransactionFilter): Promise<number>;
  updateTransaction(id: number, patch: TransactionPatch): Promise<void>;
  bulkUpdateTransactions(ids: number[], patch: TransactionPatch): Promise<number>;
  splitTransaction(id: number, parts: SplitPart[]): Promise<number[]>;
  unsplitTransaction(id: number): Promise<void>;
  transactionChildren(id: number): Promise<Transaction[]>;

  listCategoryGroups(): Promise<CategoryGroup[]>;
  listCategories(): Promise<Category[]>;
  createCategory(cat: NewCategory): Promise<number>;
  updateCategory(id: number, patch: CategoryPatch): Promise<void>;
  /** Delete a category; its transactions move to Other. Other can't be deleted. */
  deleteCategory(id: number): Promise<{ moved: number }>;
  /** How many transactions (including split parts) deleting the category would move. */
  categoryUsage(id: number): Promise<number>;
  moveCategoryToGroup(id: number, target: GroupTarget): Promise<void>;
  renameGroup(id: number, name: string): Promise<void>;
  /** Give each category in the group its own group and remove the group. */
  ungroup(id: number): Promise<void>;

  /** Change the type of transactions; categories that don't fit the new type are cleared. */
  setTransactionType(ids: number[], type: TxType): Promise<number>;
  /** A manual change: set the category, mark reviewed, and learn the merchant. */
  setTransactionCategory(id: number, categoryId: number): Promise<void>;
  /** Transactions (all profiles) a change would move, newest first; rows already in the category are left out. */
  previewRecategorize(target: RecatTarget, categoryId: number): Promise<RecatMatch[]>;
  /** Move the unlocked transactions among `ids`, marking them reviewed. Returns how many changed. */
  applyRecategorize(ids: number[], categoryId: number): Promise<number>;
  /** Save a rule for future imports, replacing one with the same kind and pattern. */
  saveRule(rule: RuleInputDto): Promise<number>;
  /** Other's transactions grouped by merchant, largest first. */
  otherGroups(): Promise<OtherGroup[]>;
  previewFtModel(modelJson: string): Promise<FtProposal[]>;
  /** Learn the chosen merchants and move their Other transactions (the app backs up first). */
  importFtModel(choices: FtChoice[]): Promise<FtReport>;
  /** Delete transactions (with their split parts and tags; refund links cleared). Backs up first in the app. */
  deleteTransactions(ids: number[]): Promise<number>;
  /** Past imports, newest first. */
  listImports(): Promise<ImportRecord[]>;
  /** Remove what an import added (never rows it skipped) so the file can be imported again. Backs up first. */
  undoImport(id: number): Promise<number>;
  /** The open possible-duplicate flag a transaction is part of (as either row), or null. */
  duplicateFlagFor(txId: number): Promise<DuplicateFlag | null>;
  /** Delete this one, delete the other one, or keep both (the pair is never flagged again). */
  resolveDuplicate(flagId: number, resolution: DuplicateResolution): Promise<void>;
  /** Notification center: the inbox behind the bell (see notifications.rs). */
  notificationsList(profileId: number | null): Promise<AppNotification[]>;
  /** Store an event unless its key was seen; `read` marks a quiet baseline item. Null when it already existed. */
  notificationsAdd(n: NewNotification, read: boolean): Promise<AppNotification | null>;
  notificationsMarkRead(id: number): Promise<void>;
  notificationsMarkAllRead(profileId: number | null): Promise<void>;
  notificationsDismiss(id: number): Promise<void>;
  /** Unread items whose banner hasn't been shown. */
  notificationsPending(profileId: number | null): Promise<AppNotification[]>;
  notificationsMarkDelivered(ids: number[]): Promise<void>;
  /**
   * Detect today's events and return the new notifications. Baseline mode (first run, or after the settings change)
   * stores what's already true as read, without banners.
   */
  notificationsRefresh(today: string, baseline: boolean): Promise<AppNotification[]>;
  /** Write a full copy of the database to `path` (a file the person chose). */
  backupDatabase(path: string): Promise<void>;
  /** Write learned merchants and rules to `path`, leaving out anything that identifies the person. */
  exportRules(path: string): Promise<{ learned: number; rules: number; leftOut: number }>;

  analyticsMonthly(profileId: number | null, range: TimeRange, today: string): Promise<MonthlyTotal[]>;
  analyticsCategories(profileId: number | null, range: TimeRange, today: string): Promise<CategoryTotal[]>;
  analyticsBudgets(profileId: number | null, today: string): Promise<BudgetStatus[]>;
  analyticsCashflow(profileId: number | null, range: TimeRange, today: string): Promise<CashFlow>;
  analyticsRecurring(profileId: number | null, today: string): Promise<Recurring[]>;
  /** Every saved recurring bill (all statuses), built from its linked charges. */
  listRecurring(profileId: number | null): Promise<Recurring[]>;
  /** Detected bills no saved recurring covers (and not dismissed). */
  recurringSuggestions(profileId: number | null): Promise<Recurring[]>;
  /** How many unlinked charges a rule would claim. */
  previewRecurring(rule: NewRecurring): Promise<number>;
  createRecurring(rule: NewRecurring): Promise<number>;
  /** Save new rules and re-match past charges. */
  updateRecurring(id: number, rule: NewRecurring): Promise<MatchReport>;
  setRecurringStatus(id: number, status: RecurringStatus): Promise<void>;
  /** Remove a bill; its charges keep everything but the link. */
  deleteRecurring(id: number): Promise<void>;
  /** "Not recurring": unlink a charge so no bill claims it again. */
  unlinkRecurring(transactionId: number): Promise<void>;
  /** A prefilled bill for "Make recurring" on a transaction. */
  draftRecurring(transactionId: number): Promise<NewRecurring>;
  dismissSuggestion(merchant: string): Promise<void>;

  /** Every tag in creation order, with use counts. */
  listTags(): Promise<Tag[]>;
  /** A new tag; without a color it takes the next one in the palette. Names are unique ignoring case. */
  createTag(name: string, color?: string | null): Promise<number>;
  updateTag(id: number, patch: TagPatch): Promise<void>;
  /** Remove a tag; its transactions keep everything else. */
  deleteTag(id: number): Promise<void>;
  /** Put tags on transactions; returns how many new links were made. */
  addTags(ids: number[], tagIds: number[]): Promise<number>;
  /** Take tags off transactions; returns how many links were removed. */
  removeTags(ids: number[], tagIds: number[]): Promise<number>;

  /** Budgets beyond each category's default: month overrides, shared group budgets, rollovers. */
  getBudgetPlan(): Promise<BudgetPlan>;
  /** Without a month: the default for all months (clears every override). With one: that month's override; null removes it. */
  setBudget(categoryId: number, month: string | null, amountCents: number | null): Promise<void>;
  /** A shared budget for a group; null goes back to the sum of its categories. */
  setGroupBudget(groupId: number, amountCents: number | null): Promise<void>;
  /** Roll leftovers forward from a month ('YYYY-MM'); null stops. */
  setRollover(categoryId: number, since: string | null): Promise<void>;
  /** Save a rebalance; the total budget must not change. */
  applyRebalance(changes: { categoryId: number; amountCents: number }[], scope: RebalanceScope, month: string): Promise<void>;

  /** The statement file a transaction came from and the extra columns it had. */
  statementInfo(id: number): Promise<StatementInfo>;

  fxUpsertMany(rates: FxRate[]): Promise<number>;
  fxRateOn(base: string, quote: string, on: string): Promise<number | null>;
  fxLatest(base: string, quote: string): Promise<number | null>;
  fxConvertCents(cents: number, base: string, quote: string, on: string): Promise<number | null>;

  searchTransactions(profileId: number | null, query: string, today: string, limit?: number): Promise<Transaction[]>;


  migrateLegacyJson(transactionsJson: string, modelJson?: string | null): Promise<LegacyReport>;
  scanWatchedFolder(): Promise<WatchScan>;

  importCsvText(profileId: number, path: string, text: string): Promise<ImportReport>;
  importOfxText(profileId: number, path: string, text: string): Promise<ImportReport>;
  importPdfDoc(profileId: number, path: string, doc: PdfTextDto, fileHash: string): Promise<ImportReport>;
}

let current: Ipc | null = null;

export function setIpc(impl: Ipc): void {
  current = impl;
}

export function ipc(): Ipc {
  if (!current) throw new Error('ipc not initialised: call setIpc() first');
  return current;
}

/** Copilot's tag colors as its picker lays them out, two rows of seven (mirrors `tags::PALETTE`). */
export const TAG_PALETTE = [
  '#e5484d', '#e35f2e', '#e8904a', '#b07a3c', '#ddb24a', '#e9d44a', '#a9b94a', '#5cb85c',
  '#6ccdc6', '#4a8ef0', '#7c6cf0', '#9a5cf0', '#d93fb8', '#b54ef0',
] as const;

/** Palette positions new tags take in turn: far-apart hues first (mirrors `tags::NEW_TAG_ORDER`). */
export const NEW_TAG_ORDER = [0, 7, 11, 9, 2, 8, 12, 4, 10, 1, 6, 13, 3, 5] as const;

export const TAG_MAX_NAME = 40;

export interface MemoryIpcSeed {
  settings?: Record<string, string>;
  /** Past imports and the transactions each one added (imports themselves only run in the app). */
  imports?: (Omit<ImportRecord, 'remaining'> & { transactionIds: number[] })[];
  profiles?: Profile[];
  sources?: Source[];
  transactions?: Transaction[];
  groups?: CategoryGroup[];
  categories?: Category[];
  fxRates?: FxRate[];
  tags?: Omit<Tag, 'count'>[];
  /** Possible duplicates found by earlier imports. */
  duplicateFlags?: DuplicateFlag[];
  /** Statement file and columns by transaction id. */
  statements?: Record<number, Omit<StatementInfo, 'sourceName'>>;
}

const DEFAULT_GROUPS: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: '🍽️', color: '#ff9500', sortOrder: 0 },
  { id: 2, name: 'Transportation', emoji: '🚗', color: '#5856d6', sortOrder: 1 },
  { id: 3, name: 'Home', emoji: '🏠', color: '#34c759', sortOrder: 2 },
];

const DEFAULT_CATEGORIES: Category[] = [
  { id: 10, groupId: 1, name: 'Groceries', emoji: '🛒', color: null, budgetCents: 60000, excluded: false, kind: 'expense', sortOrder: 0, archived: false },
  { id: 20, groupId: 2, name: 'Fuel', emoji: '⛽', color: null, budgetCents: 15000, excluded: false, kind: 'expense', sortOrder: 1, archived: false },
];

function matches(t: Transaction, f: TransactionFilter): boolean {
  if (f.profileId != null && t.profileId !== f.profileId) return false;
  if (f.from && t.postedOn < f.from) return false;
  if (f.to && t.postedOn > f.to) return false;
  if (f.categoryIds?.length && (t.categoryId == null || !f.categoryIds.includes(t.categoryId))) return false;
  if (f.sourceIds?.length && !f.sourceIds.includes(t.sourceId)) return false;
  if (f.reviewed != null && t.reviewed !== f.reviewed) return false;
  if (f.months?.length && !f.months.includes(t.postedOn.slice(0, 7))) return false;
  if (f.types?.length && !f.types.includes(t.txType ?? 'regular')) return false;
  if (f.tagIds?.length && !(t.tagIds ?? []).some((id) => f.tagIds!.includes(id))) return false;
  if (f.recurringIds?.length && (t.recurringId == null || !f.recurringIds.includes(t.recurringId))) return false;
  if (f.merchants?.length && !f.merchants.some((m) => m.trim().toLowerCase() === t.merchant.toLowerCase())) return false;
  if (f.text) {
    const q = f.text.toLowerCase();
    const hay = `${t.description} ${t.merchant} ${t.notes ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function newestFirst(a: Transaction, b: Transaction): number {
  if (a.postedOn !== b.postedOn) return a.postedOn < b.postedOn ? 1 : -1;
  return b.id - a.id;
}

/** In-memory implementation for tests and for the browser outside Tauri. */
export function createMemoryIpc(seed: MemoryIpcSeed = {}): Ipc {
  const settings = new Map(Object.entries(seed.settings ?? {}));
  const profiles = seed.profiles ?? [{ id: 1, name: 'Me', color: '#5b8cff', sortOrder: 0 }];
  const sources = seed.sources ?? [{ id: 1, profileId: 1, name: 'Imported', kind: 'csv' as const, institution: null, currency: 'USD' }];
  const transactions = (seed.transactions ?? []).map((t) => ({ ...t }));
  const groups = seed.groups ?? DEFAULT_GROUPS.map((g) => ({ ...g }));
  const categories = (seed.categories ?? DEFAULT_CATEGORIES).map((c) => ({ ...c }));
  let nextCatId = Math.max(0, ...categories.map((c) => c.id), ...groups.map((g) => g.id)) + 1;
  let nextTxId = Math.max(0, ...transactions.map((t) => t.id)) + 1;
  let nextProfileId = Math.max(0, ...profiles.map((p) => p.id)) + 1;
  const children = new Map<number, Transaction[]>();
  const fxRates: FxRate[] = (seed.fxRates ?? []).map((r) => ({ ...r }));
  const inbox = createNotificationInbox();
  const importsLog = (seed.imports ?? []).map((i) => ({ ...i, transactionIds: [...i.transactionIds] }));

  // ----- budget plan (mirror `budgets.rs`) -----
  const plan: BudgetPlan = { months: [], groups: [], rollovers: [] };
  const checkMonth = (m: string) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new Error(`not a month: ${m}`);
  };
  const checkAmount = (a: number | null) => {
    if (a != null && a < 0) throw new Error("a budget can't be negative");
  };
  const categoryById = (id: number) => {
    const c = categories.find((x) => x.id === id);
    if (!c) throw new Error('not_found');
    return c;
  };
  const budgetIn = (id: number, month: string) => plan.months.find((m) => m.categoryId === id && m.month === month)?.amountCents ?? categoryById(id).budgetCents ?? 0;
  const setOverride = (id: number, month: string, amount: number | null) => {
    plan.months = plan.months.filter((m) => !(m.categoryId === id && m.month === month));
    if (amount != null) plan.months.push({ categoryId: id, month, amountCents: amount });
    plan.months.sort((a, b) => a.categoryId - b.categoryId || a.month.localeCompare(b.month));
  };

  // ----- tags (mirror `tags.rs`) -----
  const tags: Omit<Tag, 'count'>[] = (seed.tags ?? []).map((t) => ({ ...t }));
  const duplicateFlags: DuplicateFlag[] = (seed.duplicateFlags ?? []).map((f) => ({ ...f }));
  /** Take "Possible duplicate" off a row once no open flag needs it. */
  const untagDuplicate = (txId: number) => {
    if (stillFlagged(duplicateFlags, txId)) return;
    const tag = tags.find((t) => t.name.toLowerCase() === DUPLICATE_TAG_NAME.toLowerCase());
    const row = transactions.find((t) => t.id === txId);
    if (tag && row?.tagIds) row.tagIds = row.tagIds.filter((g) => g !== tag.id);
  };
  let nextTagId = Math.max(0, ...tags.map((t) => t.id)) + 1;
  const checkedTagName = (name: string, except: number | null): string => {
    const n = name.trim();
    if (!n) throw new Error('a tag needs a name');
    if ([...n].length > TAG_MAX_NAME) throw new Error(`a tag name can be at most ${TAG_MAX_NAME} characters`);
    if (tags.some((t) => t.id !== except && t.name.toLowerCase() === n.toLowerCase())) throw new Error(`a tag named “${n}” already exists`);
    return n;
  };

  /** Rows that count toward totals: the profile's, minus excluded categories (as the core does). */
  const countedRows = (profileId: number | null) => {
    const excluded = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
    return transactions.filter((t) => (profileId == null || t.profileId === profileId) && t.txType !== 'transfer' && (t.categoryId == null || !excluded.has(t.categoryId)));
  };

  /** Most recent rate on or before `on`; falls back to the inverse pair. */
  const rateOn = (base: string, quote: string, on: string): number | null => {
    if (base === quote) return 1;
    const pick = (b: string, q: string) =>
      fxRates
        .filter((r) => r.base === b && r.quote === q && r.asOf <= on)
        .sort((a, c) => c.asOf.localeCompare(a.asOf))[0];
    const direct = pick(base, quote);
    if (direct) return direct.rate;
    const inverse = pick(quote, base);
    return inverse ? 1 / inverse.rate : null;
  };

  // ----- category management helpers (mirror the core's rules) -----
  let otherId: number | null = categories.find((c) => normalizedName(c.name) === 'other')?.id ?? null;
  const addGroup = (name: string): CategoryGroup => {
    const g = { id: nextCatId++, name: name.trim(), emoji: null, color: '#8e8e93', sortOrder: groups.length };
    groups.push(g);
    return g;
  };
  const otherCategory = (): Category => {
    const found = categories.find((c) => c.id === otherId);
    if (found) return found;
    const group = groups.find((g) => normalizedName(g.name) === 'other') ?? addGroup('Other');
    const created: Category = { id: nextCatId++, groupId: group.id, name: 'Other', emoji: '📦', color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: categories.length, archived: false };
    categories.push(created);
    otherId = created.id;
    return created;
  };
  const ensureNameFree = (name: string, except?: number) => {
    const wanted = normalizedName(name);
    if (!wanted) throw new Error('category name is empty');
    const clash = categories.find((c) => c.id !== except && normalizedName(c.name) === wanted);
    if (clash) throw new Error(`a category named ${clash.name} already exists`);
  };
  const resolveTarget = (target: GroupTarget, catName: string, current: number | null): CategoryGroup => {
    if (target === 'own') {
      const same = groups.find((g) => normalizedName(g.name) === normalizedName(catName));
      if (!same) return addGroup(catName);
      if (same.id !== current && categories.some((c) => c.groupId === same.id)) {
        throw new Error(`a group named ${same.name} already exists`);
      }
      return same;
    }
    if ('existing' in target) {
      const g = groups.find((x) => x.id === target.existing);
      if (!g) throw new Error(`group ${target.existing} not found`);
      return g;
    }
    if (!normalizedName(target.new)) throw new Error('group name is empty');
    const clash = groups.find((g) => normalizedName(g.name) === normalizedName(target.new));
    if (clash) throw new Error(`a group named ${clash.name} already exists`);
    return addGroup(target.new);
  };
  const pruneEmptyGroups = () => {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (!categories.some((c) => c.groupId === groups[i].id)) groups.splice(i, 1);
    }
  };

  // ----- saved recurrings (mirror `recurrings.rs`) -----
  const saved: SavedRecurring[] = [];
  let nextRecurringId = 1;
  let seeded = false;
  const optedOut = new Set<number>();
  const dismissed = new Set<string>();
  const addMonths = (day: string, n: number) => {
    const [y, m, d] = day.split('-').map(Number);
    const total = y * 12 + (m - 1) + n;
    const ny = Math.floor(total / 12);
    const nm = (total % 12) + 1;
    const last = new Date(ny, nm, 0).getDate();
    return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
  };
  const addDays = (day: string, n: number) => {
    const dt = new Date(`${day}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };
  const nextAfter = (freq: SavedRecurring['frequency'], day: string) =>
    freq === 'weekly' ? addDays(day, 7) : freq === 'biweekly' ? addDays(day, 14) : addMonths(day, freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1);
  // Mirrors `recurrings::next_due`: with a due day, a charge pays the nearest due date.
  const nextDue = (s: SavedRecurring, last: string): string => {
    if (s.dayOfMonth == null || s.frequency === 'weekly' || s.frequency === 'biweekly') return nextAfter(s.frequency, last);
    const dueIn = (month: string) => {
      const [y, m] = month.split('-').map(Number);
      const days = new Date(y, m, 0).getDate();
      return `${month}-${String(Math.min(s.dayOfMonth!, days)).padStart(2, '0')}`;
    };
    const first = `${last.slice(0, 7)}-01`;
    const dayMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
    const paid = [addMonths(first, -1), first, addMonths(first, 1)]
      .map((d) => dueIn(d.slice(0, 7)))
      .sort((a, b) => Math.abs(dayMs(last) - dayMs(a)) - Math.abs(dayMs(last) - dayMs(b)))[0];
    return dueIn(nextAfter(s.frequency, paid).slice(0, 7));
  };
  const isCandidate = (t: Transaction) => (t.txType ?? 'regular') === 'regular' && t.amountCents < 0 && !optedOut.has(t.id);
  const fitsRule = (r: NewRecurring, t: Transaction) => {
    const size = -t.amountCents;
    if (size < r.minCents || size > r.maxCents) return false;
    const nameOk =
      r.matchKind === 'merchant'
        ? t.merchant.trim().toLowerCase() === r.pattern.trim().toLowerCase()
        : normalizeDescription(t.description).includes(normalizeDescription(r.pattern));
    if (!nameOk) return false;
    if (r.dayOfMonth == null) return true;
    return daysFromDue(t.postedOn, r.dayOfMonth) <= 3;
  };
  /** Days from `day` to the nearest due date (last, this or next month; day clamped to month length). */
  const daysFromDue = (day: string, due: number) => {
    const [y, m] = day.split('-').map(Number);
    const at = Date.UTC(y, m - 1, Number(day.slice(8, 10)));
    let best = Infinity;
    for (const shift of [-1, 0, 1]) {
      const month = new Date(Date.UTC(y, m - 1 + shift, 1));
      const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
      const dueAt = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(due, last));
      best = Math.min(best, Math.abs(at - dueAt) / 86_400_000);
    }
    return best;
  };
  const rematchRecurring = (id: number): MatchReport => {
    const r = saved.find((x) => x.id === id);
    if (!r) throw new Error('not_found');
    let added = 0;
    let removed = 0;
    for (const t of transactions) {
      const was = t.recurringId === id;
      const fits = isCandidate(t) && (t.recurringId == null || was) && fitsRule(r, t);
      if (was && !fits) {
        t.recurringId = null;
        removed++;
      } else if (!was && fits) {
        t.recurringId = id;
        added++;
      }
    }
    return { added, removed };
  };
  const titleCase = (key: string) => key.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  const dayFor = (freq: SavedRecurring['frequency'], day: string) => (freq === 'weekly' || freq === 'biweekly' ? null : Number(day.slice(8, 10)));
  const createSaved = (rule: NewRecurring): number => {
    const id = nextRecurringId++;
    saved.push({ ...rule, pattern: rule.pattern.trim().toLowerCase(), id, status: 'active', createdOn: '2026-01-01' });
    rematchRecurring(id);
    return id;
  };
  const ensureSeeded = () => {
    if (seeded) return;
    seeded = true;
    for (const r of detectRecurring(transactions)) {
      const band = Math.max(Math.trunc(r.typicalAmountCents / 100) * 35, 500);
      const id = createSaved({
        name: titleCase(r.merchant),
        categoryId: r.categoryId,
        matchKind: 'merchant',
        pattern: r.merchant,
        minCents: Math.max(0, r.typicalAmountCents - band),
        maxCents: r.typicalAmountCents + band,
        frequency: r.cadence,
        dayOfMonth: dayFor(r.cadence, r.lastDate),
      });
      const bill = saved.find((x) => x.id === id)!;
      const linked = transactions.filter((t) => t.recurringId === id).length;
      if (bill.dayOfMonth != null && linked < r.occurrences * 0.8) {
        bill.dayOfMonth = null;
        rematchRecurring(id);
      }
    }
  };
  const recurringViews = (profileId: number | null): Recurring[] => {
    ensureSeeded();
    return saved
      .filter((s) => profileId == null || transactions.some((t) => t.recurringId === s.id && t.profileId === profileId))
      .map((s) => {
        const charges = transactions
          .filter((t) => t.recurringId === s.id && (profileId == null || t.profileId === profileId))
          .sort((a, b) => a.postedOn.localeCompare(b.postedOn));
        const sizes = charges.map((t) => -t.amountCents).sort((a, b) => a - b);
        const mid = Math.floor(sizes.length / 2);
        const median = sizes.length % 2 ? sizes[mid] : Math.trunc((sizes[mid - 1] + sizes[mid]) / 2);
        const typical = sizes.length ? median : Math.round((s.minCents + s.maxCents) / 2);
        const lastDate = charges.at(-1)?.postedOn ?? s.createdOn;
        return {
          merchant: s.matchKind === 'merchant' ? s.pattern : s.name.toLowerCase(),
          categoryId: s.categoryId ?? charges.at(-1)?.categoryId ?? null,
          typicalAmountCents: typical,
          cadence: s.frequency,
          lastDate,
          nextDate: nextDue(s, lastDate),
          occurrences: charges.length,
          saved: { ...s },
        };
      })
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || a.merchant.localeCompare(b.merchant));
  };

  const learned = new Map<string, number>();
  const rules: { id: number; kind: RuleInputDto['kind']; pattern: string; categoryId: number }[] = [];
  let nextRuleId = 1;

  /** The type a category implies (as the core does). */
  const typeOfCategory = (id: number | null): TxType => {
    const kind = categories.find((c) => c.id === id)?.kind;
    return kind === 'income' ? 'income' : kind === 'transfer' ? 'transfer' : 'regular';
  };
  const applyPatch = (t: Transaction, patch: TransactionPatch) => {
    if (patch.categoryId !== undefined) t.categoryId = patch.categoryId;
    if (patch.categoryId != null) t.txType = typeOfCategory(patch.categoryId);
    if (patch.categoryLocked !== undefined) t.categoryLocked = patch.categoryLocked;
    if (patch.reviewed !== undefined) t.reviewed = patch.reviewed;
    if (patch.notes !== undefined) t.notes = patch.notes;
  };

  return {
    async getSetting(key) {
      return settings.get(key) ?? null;
    },
    async setSetting(key, value) {
      settings.set(key, value);
    },
    async listProfiles() {
      return profiles.map((p) => ({ ...p }));
    },
    async createProfile(name, color) {
      const id = nextProfileId++;
      profiles.push({ id, name, color: color ?? '#5b8cff', sortOrder: profiles.length });
      return id;
    },
    async renameProfile(id, name) {
      const p = profiles.find((x) => x.id === id);
      if (p) p.name = name;
    },
    async deleteProfile(id) {
      const idx = profiles.findIndex((x) => x.id === id);
      if (idx >= 0) profiles.splice(idx, 1);
    },
    async listSources() {
      return sources.map((x) => ({ ...x }));
    },

    async setTransactionCategory(id, categoryId) {
      const t = transactions.find((x) => x.id === id);
      if (!t) throw new Error('not_found');
      t.categoryId = categoryId;
      t.txType = typeOfCategory(categoryId);
      t.reviewed = true;
      if (t.merchant && !isPaymentPlatform(t.merchant)) learned.set(t.merchant, categoryId);
    },
    async setTransactionType(ids, type) {
      const keep = type === 'regular' ? 'expense' : type === 'income' ? 'income' : null;
      let n = 0;
      for (const t of transactions) {
        if (!ids.includes(t.id)) continue;
        t.txType = type;
        if (type !== 'regular') t.recurringId = null;
        if (t.categoryId != null && categories.find((c) => c.id === t.categoryId)?.kind !== keep) t.categoryId = null;
        n++;
      }
      return n;
    },
    async previewRecategorize(target, categoryId) {
      const candidates = transactions.filter((t) => t.categoryId !== categoryId).sort(newestFirst);
      let hits: Transaction[];
      if (target.kind === 'merchant') {
        const key = target.value.trim().toLowerCase();
        if (!key || isPaymentPlatform(key)) return [];
        hits = candidates.filter((t) => t.merchant.toLowerCase() === key);
      } else {
        const text = normalizeDescription(target.value);
        if (text.length < MIN_CONTAINS) return [];
        hits = candidates.filter((t) => !isPaymentPlatform(t.merchant) && normalizeDescription(t.description).includes(text));
      }
      return hits.map((t) => ({ transaction: { ...t }, similar: false, locked: t.categoryLocked }));
    },
    async applyRecategorize(ids, categoryId) {
      let n = 0;
      for (const t of transactions) {
        if (ids.includes(t.id) && !t.categoryLocked) {
          t.categoryId = categoryId;
          t.txType = typeOfCategory(categoryId);
          t.reviewed = true;
          n++;
        }
      }
      return n;
    },
    async saveRule(rule) {
      const pattern = normalizeDescription(rule.pattern);
      for (let i = rules.length - 1; i >= 0; i--) {
        if (rules[i].kind === rule.kind && rules[i].pattern === pattern) rules.splice(i, 1);
      }
      const id = nextRuleId++;
      rules.unshift({ id, kind: rule.kind, pattern, categoryId: rule.categoryId });
      return id;
    },
    async otherGroups() {
      const by = new Map<string, OtherGroup>();
      for (const t of transactions) {
        if (t.categoryId != null && t.categoryId !== otherId) continue;
        const key = t.merchant.toLowerCase();
        const g = by.get(key) ?? { merchant: key, count: 0, totalCents: 0, platform: isPaymentPlatform(key), sampleDescription: t.description };
        g.count++;
        g.totalCents += Math.abs(t.amountCents);
        by.set(key, g);
      }
      return [...by.values()].sort((a, b) => b.count - a.count || b.totalCents - a.totalCents || a.merchant.localeCompare(b.merchant));
    },
    async previewFtModel(modelJson) {
      const model = JSON.parse(modelJson) as { learningModel?: Record<string, string> };
      const out: FtProposal[] = [];
      for (const [raw, ftCategory] of Object.entries(model.learningModel ?? {})) {
        const merchant = raw.trim().toLowerCase();
        if (!merchant || isPaymentPlatform(merchant)) continue;
        const last = ftCategory.split(' - ').pop() ?? ftCategory;
        const found = categories.find((c) => normalizedName(c.name) === normalizedName(ftCategory) || normalizedName(c.name) === normalizedName(last));
        const target: FtTarget = found ? { kind: 'existing', value: found.id } : { kind: 'new', value: ftCategory.trim() };
        const moves = transactions.filter((t) => t.merchant.toLowerCase() === merchant && !t.categoryLocked && (t.categoryId == null || t.categoryId === otherId)).length;
        out.push({ merchant, ftCategory, target, moves });
      }
      return out.sort((a, b) => a.ftCategory.localeCompare(b.ftCategory) || a.merchant.localeCompare(b.merchant));
    },
    async deleteTransactions(ids) {
      const gone = new Set(ids);
      duplicatesBeforeDelete(duplicateFlags, gone, (txId) => untagDuplicate(txId));
      const before = transactions.length;
      for (let i = transactions.length - 1; i >= 0; i--) if (gone.has(transactions[i].id)) transactions.splice(i, 1);
      for (const t of transactions) if (t.refundOf != null && gone.has(t.refundOf)) t.refundOf = null;
      for (const g of gone) children.delete(g);
      for (const imp of importsLog) imp.transactionIds = imp.transactionIds.filter((x) => !gone.has(x));
      return before - transactions.length;
    },
    async duplicateFlagFor(txId) {
      return openFlagFor(duplicateFlags, txId);
    },
    async resolveDuplicate(flagId, resolution) {
      const flag = duplicateFlags.find((f) => f.id === flagId);
      if (!flag || flag.resolution) return;
      if (resolution === 'kept') {
        settle(flag, 'kept');
        if (flag.txId != null) untagDuplicate(flag.txId);
        return;
      }
      const target = resolution === 'deleted' ? flag.txId : flag.otherId;
      if (target != null) await this.deleteTransactions([target]);
    },
    async listImports() {
      return [...importsLog]
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt) || b.id - a.id)
        .map(({ transactionIds, ...r }) => ({ ...r, remaining: transactionIds.filter((x) => transactions.some((t) => t.id === x)).length }));
    },
    async undoImport(id) {
      const imp = importsLog.find((i) => i.id === id);
      if (!imp) return 0;
      const removed = await this.deleteTransactions(imp.transactionIds);
      importsLog.splice(importsLog.indexOf(imp), 1);
      return removed;
    },
    async notificationsList(profileId) {
      return inbox.list(profileId);
    },
    async notificationsAdd(n, read) {
      return inbox.add(n, read);
    },
    async notificationsMarkRead(id) {
      inbox.markRead(id);
    },
    async notificationsMarkAllRead(profileId) {
      inbox.markAllRead(profileId);
    },
    async notificationsDismiss(id) {
      inbox.dismiss(id);
    },
    async notificationsPending(profileId) {
      return inbox.pending(profileId);
    },
    async notificationsMarkDelivered(ids) {
      inbox.markDelivered(ids);
    },
    async notificationsRefresh(today, baseline) {
      const first = baseline || !settings.has(BASELINED_KEY);
      const config = configFrom(settings.get(NOTIFICATION_CONFIG_KEY) ?? null, settings.get(OLD_HORIZON_KEY) ?? null);
      const fresh: AppNotification[] = [];
      const candidates = produceCandidates({
        transactions,
        recurring: recurringViews(null),
        categories,
        plan,
        config,
        today,
        isSplitParent: (id) => (children.get(id)?.length ?? 0) > 0,
        duplicateFlags,
        importFileName: (id) => importsLog.find((i) => i.id === id)?.fileName,
      });
      for (const n of candidates) {
        if (!config.kinds[n.kind]?.bell) continue;
        const saved = inbox.add(n, first);
        if (saved && !first) fresh.push(saved);
      }
      if (first) settings.set(BASELINED_KEY, new Date().toISOString());
      inbox.prune();
      return fresh;
    },
    async backupDatabase() {
      // Nothing to copy in memory; the installed app writes the file.
    },
    async exportRules() {
      // The installed app builds and writes the file (with its privacy filter) in Rust.
      return { learned: 0, rules: 0, leftOut: 0 };
    },
    async importFtModel(choices) {
      const report: FtReport = { learned: 0, moved: 0, created: 0 };
      for (const choice of choices) {
        let categoryId: number;
        if (choice.target.kind === 'existing') categoryId = choice.target.value;
        else {
          const name = choice.target.value;
          const existing = categories.find((c) => normalizedName(c.name) === normalizedName(name));
          if (existing) categoryId = existing.id;
          else {
            const group = groups.find((g) => normalizedName(g.name) === normalizedName(name)) ?? addGroup(name);
            const created: Category = { id: nextCatId++, groupId: group.id, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: categories.length, archived: false };
            categories.push(created);
            categoryId = created.id;
            report.created++;
          }
        }
        const merchant = choice.merchant.trim().toLowerCase();
        if (isPaymentPlatform(merchant)) continue;
        learned.set(merchant, categoryId);
        report.learned++;
        for (const t of transactions) {
          if (t.merchant.toLowerCase() === merchant && !t.categoryLocked && (t.categoryId == null || t.categoryId === otherId)) {
            t.categoryId = categoryId;
            t.reviewed = true;
            report.moved++;
          }
        }
      }
      return report;
    },

    async listTransactions(filter) {
      let rows = transactions.filter((t) => matches(t, filter)).sort(newestFirst);
      const offset = filter.offset ?? 0;
      if (filter.limit != null) rows = rows.slice(offset, offset + filter.limit);
      else if (offset) rows = rows.slice(offset);
      return rows.map((t) => ({ ...t }));
    },
    async countTransactions(filter) {
      return transactions.filter((t) => matches(t, filter)).length;
    },
    async updateTransaction(id, patch) {
      const t = transactions.find((x) => x.id === id);
      if (t) applyPatch(t, patch);
    },
    async bulkUpdateTransactions(ids, patch) {
      let n = 0;
      for (const t of transactions) {
        if (ids.includes(t.id)) {
          applyPatch(t, patch);
          n++;
        }
      }
      return n;
    },
    async splitTransaction(id, parts) {
      const parent = transactions.find((x) => x.id === id);
      if (!parent) throw new Error('not_found');
      if (parts.length < 2) throw new Error('a split needs at least two parts');
      const sum = parts.reduce((acc, p) => acc + p.amountCents, 0);
      if (sum !== parent.amountCents) throw new Error(`split parts sum to ${sum}, expected ${parent.amountCents}`);
      children.set(id, []);
      const ids: number[] = [];
      parts.forEach((p, i) => {
        const childId = nextTxId++;
        const child: Transaction = {
          ...parent,
          id: childId,
          description: p.description ?? `${parent.description} (split ${i + 1})`,
          amountCents: p.amountCents,
          categoryId: p.categoryId,
          categoryLocked: false,
          reviewed: true,
          refundOf: null,
        };
        children.get(id)!.push(child);
        ids.push(childId);
      });
      parent.reviewed = true;
      return ids;
    },
    async unsplitTransaction(id) {
      children.delete(id);
    },
    async transactionChildren(id) {
      return (children.get(id) ?? []).map((c) => ({ ...c }));
    },

    async analyticsMonthly(profileId, range, today) {
      const rows = countedRows(profileId);
      return monthlyTotals(rows, resolveRange(range, today));
    },
    async analyticsCategories(profileId, range, today) {
      const rows = countedRows(profileId);
      return categoryTotals(rows, resolveRange(range, today), children);
    },
    async analyticsBudgets(profileId, today) {
      const rows = transactions.filter((t) => profileId == null || t.profileId === profileId);
      const month = budgetsForMonth(plan, categories, today.slice(0, 7));
      const meta: CategoryMeta[] = month.categories.map((c) => ({ id: c.id, budgetCents: c.budgetCents ?? null, excluded: c.excluded }));
      return budgetStatus(rows, meta, today, children);
    },
    async analyticsCashflow(profileId, range, today) {
      const rows = countedRows(profileId);
      return cashFlow(rows, resolveRange(range, today));
    },
    async listRecurring(profileId) {
      return recurringViews(profileId);
    },
    async analyticsRecurring(profileId, today) {
      return recurringViews(profileId).filter((r) => r.saved?.status === 'active' && r.nextDate >= today);
    },
    async recurringSuggestions(profileId) {
      ensureSeeded();
      const covered = new Set([
        ...transactions.filter((t) => t.recurringId != null).map((t) => t.merchant),
        ...saved.filter((s) => s.matchKind === 'merchant').map((s) => s.pattern),
        ...dismissed,
      ]);
      return detectRecurring(transactions.filter((t) => profileId == null || t.profileId === profileId)).filter((r) => !covered.has(r.merchant));
    },
    async previewRecurring(rule) {
      return transactions.filter((t) => isCandidate(t) && t.recurringId == null && fitsRule(rule, t)).length;
    },
    async createRecurring(rule) {
      ensureSeeded();
      return createSaved(rule);
    },
    async updateRecurring(id, rule) {
      const r = saved.find((x) => x.id === id);
      if (!r) throw new Error('not_found');
      Object.assign(r, rule, { pattern: rule.pattern.trim().toLowerCase() });
      return rematchRecurring(id);
    },
    async setRecurringStatus(id, status) {
      const r = saved.find((x) => x.id === id);
      if (r) r.status = status;
    },
    async deleteRecurring(id) {
      for (const t of transactions) if (t.recurringId === id) t.recurringId = null;
      const i = saved.findIndex((x) => x.id === id);
      if (i >= 0) saved.splice(i, 1);
    },
    async unlinkRecurring(transactionId) {
      const t = transactions.find((x) => x.id === transactionId);
      if (t) t.recurringId = null;
      optedOut.add(transactionId);
    },
    async draftRecurring(transactionId) {
      const t = transactions.find((x) => x.id === transactionId);
      if (!t) throw new Error('not_found');
      const size = Math.abs(t.amountCents);
      const frequency = detectRecurring(transactions.filter((x) => x.merchant === t.merchant))[0]?.cadence ?? 'monthly';
      return {
        name: titleCase(t.merchant),
        categoryId: t.categoryId,
        matchKind: 'merchant',
        pattern: t.merchant,
        minCents: Math.round(size * 0.8),
        maxCents: Math.round(size * 1.2),
        frequency,
        dayOfMonth: dayFor(frequency, t.postedOn),
      };
    },
    async listTags() {
      return tags.map((t) => ({ ...t, count: transactions.filter((x) => x.tagIds?.includes(t.id)).length }));
    },
    async createTag(name, color) {
      const tag = { id: nextTagId++, name: checkedTagName(name, null), color: color ?? TAG_PALETTE[NEW_TAG_ORDER[tags.length % NEW_TAG_ORDER.length]] };
      tags.push(tag);
      return tag.id;
    },
    async updateTag(id, patch) {
      const tag = tags.find((t) => t.id === id);
      if (!tag) throw new Error('not_found');
      if (patch.name != null) tag.name = checkedTagName(patch.name, id);
      if (patch.color != null) tag.color = patch.color;
    },
    async deleteTag(id) {
      const i = tags.findIndex((t) => t.id === id);
      if (i >= 0) tags.splice(i, 1);
      for (const t of transactions) if (t.tagIds?.includes(id)) t.tagIds = t.tagIds.filter((x) => x !== id);
    },
    async addTags(ids, tagIds) {
      let made = 0;
      for (const t of transactions) {
        if (!ids.includes(t.id)) continue;
        const have = new Set(t.tagIds ?? []);
        for (const g of tagIds) {
          if (!tags.some((x) => x.id === g) || have.has(g)) continue;
          have.add(g);
          made++;
        }
        t.tagIds = [...have].sort((a, b) => a - b);
      }
      return made;
    },
    async removeTags(ids, tagIds) {
      let removed = 0;
      for (const t of transactions) {
        if (!ids.includes(t.id) || !t.tagIds) continue;
        const keep = t.tagIds.filter((g) => !tagIds.includes(g));
        removed += t.tagIds.length - keep.length;
        t.tagIds = keep;
      }
      return removed;
    },
    async getBudgetPlan() {
      return structuredClone(plan);
    },
    async setBudget(categoryId, month, amountCents) {
      checkAmount(amountCents);
      if (month != null) checkMonth(month);
      const c = categoryById(categoryId);
      if (month == null) {
        c.budgetCents = amountCents;
        plan.months = plan.months.filter((m) => m.categoryId !== categoryId);
      } else setOverride(categoryId, month, amountCents);
    },
    async setGroupBudget(groupId, amountCents) {
      checkAmount(amountCents);
      if (!groups.some((g) => g.id === groupId)) throw new Error('not_found');
      plan.groups = plan.groups.filter((g) => g.groupId !== groupId);
      if (amountCents != null) plan.groups.push({ groupId, amountCents });
      plan.groups.sort((a, b) => a.groupId - b.groupId);
    },
    async setRollover(categoryId, since) {
      if (since != null) checkMonth(since);
      categoryById(categoryId);
      plan.rollovers = plan.rollovers.filter((r) => r.categoryId !== categoryId);
      if (since != null) plan.rollovers.push({ categoryId, since });
      plan.rollovers.sort((a, b) => a.categoryId - b.categoryId);
    },
    async applyRebalance(changes, scope, month) {
      checkMonth(month);
      for (const c of changes) checkAmount(c.amountCents);
      const before = changes.reduce((s, c) => s + budgetIn(c.categoryId, month), 0);
      const after = changes.reduce((s, c) => s + c.amountCents, 0);
      if (before !== after) throw new Error(`a rebalance must keep the total budget (${before} before, ${after} after)`);
      for (const c of changes) {
        if (scope === 'thisMonth') setOverride(c.categoryId, month, c.amountCents);
        else {
          categoryById(c.categoryId).budgetCents = c.amountCents;
          plan.months = plan.months.filter((m) => !(m.categoryId === c.categoryId && m.month >= month));
        }
      }
    },
    async statementInfo(id) {
      const t = transactions.find((x) => x.id === id);
      if (!t) throw new Error('not_found');
      const kept = seed.statements?.[id];
      return {
        fileName: kept?.fileName ?? null,
        importedAt: kept?.importedAt ?? null,
        sourceName: sources.find((s) => s.id === t.sourceId)?.name ?? '',
        fields: kept?.fields ?? [],
      };
    },
    async dismissSuggestion(merchant) {
      dismissed.add(merchant.trim().toLowerCase());
    },

    async fxUpsertMany(incoming) {
      let n = 0;
      for (const r of incoming) {
        if (r.rate <= 0) continue;
        const existing = fxRates.find((x) => x.base === r.base && x.quote === r.quote && x.asOf === r.asOf);
        if (existing) existing.rate = r.rate;
        else fxRates.push({ ...r });
        n++;
      }
      return n;
    },
    async fxRateOn(base, quote, on) {
      return rateOn(base, quote, on);
    },
    async fxLatest(base, quote) {
      if (base === quote) return 1;
      const matches = fxRates.filter((r) => r.base === base && r.quote === quote).sort((a, b) => b.asOf.localeCompare(a.asOf));
      return matches.length ? matches[0].rate : null;
    },
    async fxConvertCents(cents, base, quote, on) {
      const rate = rateOn(base, quote, on);
      return rate == null ? null : Math.round(cents * rate);
    },

    async searchTransactions(profileId, query, today, limit = 100) {
      const rows = transactions.filter((t) => profileId == null || t.profileId === profileId);
      return runSearch(rows, parseQuery(query, today), limit);
    },

    async migrateLegacyJson(transactionsJson) {
      // Minimal mirror: count rows the way the Rust importer reports, enough for UI.
      const parseRows = (): unknown[] => {
        try {
          const parsed = JSON.parse(transactionsJson);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      };
      const rows = parseRows();
      return {
        transactionsInserted: rows.length,
        transactionsDuplicate: 0,
        profilesCreated: 0,
        sourcesCreated: 0,
        categoriesCreated: 0,
        merchantsLearned: 0,
      };
    },
    async scanWatchedFolder() {
      return { filesScanned: 0, filesImported: 0, transactionsInserted: 0, transactionsDuplicate: 0 };
    },

    async listCategoryGroups() {
      return groups.map((g) => ({ ...g })).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async listCategories() {
      return categories.map((c) => ({ ...c, isOther: c.id === otherId }));
    },
    async createCategory(cat) {
      let group: CategoryGroup;
      if (cat.groupTarget) {
        ensureNameFree(cat.name);
        group = resolveTarget(cat.groupTarget, cat.name, null);
      } else {
        group = groups.find((g) => g.name === cat.group) ?? addGroup(cat.group);
      }
      const id = nextCatId++;
      categories.push({
        id,
        groupId: group.id,
        name: cat.name.trim(),
        emoji: cat.emoji ?? null,
        color: cat.color ?? null,
        budgetCents: cat.budgetCents ?? null,
        excluded: cat.excluded ?? false,
        kind: cat.kind ?? 'expense',
        sortOrder: categories.length,
        archived: false,
      });
      return id;
    },
    async updateCategory(id, patch) {
      const c = categories.find((x) => x.id === id);
      if (!c) return;
      if (patch.name !== undefined) {
        ensureNameFree(patch.name, id);
        // A top-level category lives alone in a group of its own name: keep the two in step.
        const own = groups.find((g) => g.id === c.groupId);
        const solo = own && normalizedName(own.name) === normalizedName(c.name) && categories.filter((x) => x.groupId === own.id).length === 1;
        if (own && solo) {
          const clash = groups.find((g) => g.id !== own.id && normalizedName(g.name) === normalizedName(patch.name!));
          if (clash) throw new Error(`a group named ${clash.name} already exists`);
          own.name = patch.name.trim();
        }
        c.name = patch.name.trim();
      }
      if (patch.emoji !== undefined) c.emoji = patch.emoji;
      if (patch.color !== undefined) c.color = patch.color;
      if (patch.budgetCents !== undefined) c.budgetCents = patch.budgetCents;
      if (patch.excluded !== undefined) c.excluded = patch.excluded;
      if (patch.archived !== undefined) c.archived = patch.archived;
    },
    async categoryUsage(id) {
      return [...transactions, ...[...children.values()].flat()].filter((t) => t.categoryId === id).length;
    },
    async deleteCategory(id) {
      if (id === otherId) throw new Error("Other can't be deleted");
      const idx = categories.findIndex((x) => x.id === id);
      if (idx === -1) throw new Error(`category ${id} not found`);
      const other = otherCategory();
      let moved = 0;
      const all = [...transactions, ...[...children.values()].flat()];
      for (const t of all) if (t.categoryId === id) { t.categoryId = other.id; moved++; }
      categories.splice(idx, 1);
      pruneEmptyGroups();
      return { moved };
    },
    async moveCategoryToGroup(id, target) {
      const c = categories.find((x) => x.id === id);
      if (!c) throw new Error(`category ${id} not found`);
      c.groupId = resolveTarget(target, c.name, c.groupId).id;
      pruneEmptyGroups();
    },
    async renameGroup(id, name) {
      if (!normalizedName(name)) throw new Error('group name is empty');
      const clash = groups.find((g) => g.id !== id && normalizedName(g.name) === normalizedName(name));
      if (clash) throw new Error(`a group named ${clash.name} already exists`);
      const g = groups.find((x) => x.id === id);
      if (g) g.name = name.trim();
    },
    async ungroup(id) {
      const members = categories.filter((c) => c.groupId === id);
      const targets = members.map((c) => resolveTarget('own', c.name, c.groupId));
      members.forEach((c, i) => (c.groupId = targets[i].id));
      pruneEmptyGroups();
    },
    async importCsvText() {
      throw new Error('import is only available in the desktop app');
    },
    async importOfxText() {
      throw new Error('import is only available in the desktop app');
    },
    async importPdfDoc() {
      throw new Error('import is only available in the desktop app');
    },
  };
}
