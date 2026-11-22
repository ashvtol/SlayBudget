/** Shared DTOs mirroring the Rust core types. Money is integer cents. */

export interface Profile {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Source {
  id: number;
  profileId: number;
  name: string;
  kind: 'csv' | 'pdf' | 'ofx' | 'bank' | 'manual';
  institution: string | null;
  currency: string;
}

export interface CategoryGroup {
  id: number;
  name: string;
  emoji: string | null;
  color: string;
  sortOrder: number;
}

export interface Category {
  id: number;
  groupId: number;
  name: string;
  emoji: string | null;
  color: string | null;
  budgetCents: number | null;
  excluded: boolean;
  kind: 'expense' | 'income' | 'transfer';
  sortOrder: number;
  archived: boolean;
  /** The fallback category: can be renamed, never deleted. */
  isOther?: boolean;
}

export interface Transaction {
  id: number;
  profileId: number;
  sourceId: number;
  postedOn: string; // YYYY-MM-DD
  description: string;
  merchant: string;
  amountCents: number;
  currency: string;
  categoryId: number | null;
  categoryLocked: boolean;
  reviewed: boolean;
  notes: string | null;
  refundOf: number | null;
  /** Regular spending, Income, or an internal Transfer. Absent means regular. */
  txType?: TxType;
  /** The saved recurring bill this charge belongs to. */
  recurringId?: number | null;
  /** Tags on this row, by id ascending. Absent means none. */
  tagIds?: number[];
}

/** Budgets beyond each category's default (`Category.budgetCents`, "all months"). */
export interface BudgetPlan {
  /** Per-month overrides ('YYYY-MM'). */
  months: { categoryId: number; month: string; amountCents: number }[];
  /** Shared group budgets: the group has one budget, its categories none of their own. */
  groups: { groupId: number; amountCents: number }[];
  /** Categories rolling leftovers forward, from a month on. */
  rollovers: { categoryId: number; since: string }[];
}

export type RebalanceScope = 'thisMonth' | 'fromNowOn';

/** Where a transaction came from: its statement file and extra statement columns. */
export interface StatementInfo {
  fileName: string | null;
  importedAt: string | null;
  sourceName: string;
  /** Extra statement columns as [label, value], in file order. */
  fields: [string, string][];
}

/** A label for transactions (Copilot's tags), shared by all profiles. */
export interface Tag {
  id: number;
  name: string;
  color: string;
  /** How many transactions carry it. */
  count: number;
}

export interface TagPatch {
  name?: string;
  color?: string;
}

export type TxType = 'regular' | 'income' | 'transfer';

export interface TransactionFilter {
  profileId?: number | null; // undefined/null = combined view
  from?: string;
  to?: string;
  categoryIds?: number[];
  sourceIds?: number[];
  reviewed?: boolean;
  text?: string;
  /** Calendar months ("2026-06"); a row matches any of them. */
  months?: string[];
  /** Merchant keys; a row matches any of them. */
  merchants?: string[];
  /** Transaction types; a row matches any of them. */
  types?: TxType[];
  /** Saved recurring bills; a row linked to any of them matches. */
  recurringIds?: number[];
  /** Tags; a row with any of them matches. */
  tagIds?: number[];
  limit?: number;
  offset?: number;
}

export interface TransactionPatch {
  categoryId?: number | null;
  categoryLocked?: boolean;
  reviewed?: boolean;
  notes?: string | null;
}

export interface SplitPart {
  amountCents: number;
  categoryId: number | null;
  description?: string | null;
}

export type TimeRange = 'week' | 'month' | 'threeMonths' | 'sixMonths' | 'ytd' | 'year' | 'all';

export interface MonthlyTotal {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface CategoryTotal {
  categoryId: number | null;
  totalCents: number;
  count: number;
}

export interface BudgetStatus {
  categoryId: number;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  projectedCents: number;
  overBudget: boolean;
}

export interface Flow {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
}

export interface CashFlow {
  current: Flow;
  previous: Flow;
  netDeltaCents: number;
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Recurring {
  merchant: string;
  categoryId: number | null;
  typicalAmountCents: number;
  cadence: Cadence;
  lastDate: string;
  nextDate: string;
  occurrences: number;
  /** The saved bill behind this view; absent for a detected suggestion. */
  saved?: SavedRecurring | null;
}

export type RecurringStatus = 'active' | 'paused' | 'archived';
export type RecurringMatch = 'merchant' | 'contains';

/** A recurring bill's rules (Copilot): what it matches and when it's due. */
export interface NewRecurring {
  name: string;
  categoryId: number | null;
  matchKind: RecurringMatch;
  pattern: string;
  /** Charge size bounds, positive cents. */
  minCents: number;
  maxCents: number;
  frequency: Cadence;
  /** Expected day of the month (±3 days); null = any day. */
  dayOfMonth: number | null;
}

export interface SavedRecurring extends NewRecurring {
  id: number;
  status: RecurringStatus;
  createdOn: string;
}

export interface MatchReport {
  added: number;
  removed: number;
}

/** Minimal category shape the pure analytics layer needs for budgets. */
export interface CategoryMeta {
  id: number;
  budgetCents: number | null;
  excluded: boolean;
}

/** Where a category goes: an existing group, a new group, or its own (top-level). */
export type GroupTarget = { existing: number } | { new: string } | 'own';

export interface NewCategory {
  group: string;
  /** When set, the name must be unique and the category goes here (ignores `group`). */
  groupTarget?: GroupTarget;
  name: string;
  emoji?: string | null;
  color?: string | null;
  budgetCents?: number | null;
  excluded?: boolean;
  kind?: 'expense' | 'income' | 'transfer';
}

export interface CategoryPatch {
  name?: string;
  emoji?: string | null;
  color?: string | null;
  budgetCents?: number | null;
  excluded?: boolean;
  archived?: boolean;
}

/** A row that looks like one you already had (crates/core/src/duplicates.rs). */
export interface DuplicateFlag {
  id: number;
  /** The new row, and the existing row it looks like (null once deleted). */
  txId: number | null;
  otherId: number | null;
  importId: number | null;
  confidence: 'certain' | 'likely';
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: DuplicateResolution | null;
}
export type DuplicateResolution = 'deleted' | 'kept' | 'other_deleted';

export interface ImportReport {
  importId?: number | null;
  sourceName: string;
  inserted: number;
  duplicates: number;
  skipped: number;
  alreadyImported: boolean;
  /** Rows tagged "Possible duplicate" by this import. */
  flags?: DuplicateFlag[];
}

export interface PdfItemDto { x: number; text: string }
export interface PdfLineDto { y: number; items: PdfItemDto[] }
export interface PdfTextDto { lines: PdfLineDto[]; filename: string }

export interface FxRate {
  base: string;
  quote: string;
  asOf: string; // YYYY-MM-DD
  rate: number;
}

export interface LegacyReport {
  transactionsInserted: number;
  transactionsDuplicate: number;
  profilesCreated: number;
  sourcesCreated: number;
  categoriesCreated: number;
  merchantsLearned: number;
}

export interface WatchScan {
  filesScanned: number;
  filesImported: number;
  transactionsInserted: number;
  transactionsDuplicate: number;
}

// ----- recategorizing with rules -----
export type RecatTarget = { kind: 'merchant' | 'contains'; value: string };
export interface RecatMatch {
  transaction: Transaction;
  /** A near spelling of the merchant (fuzzy match); starts unticked. */
  similar: boolean;
  locked: boolean;
}
export interface RuleInputDto {
  kind: 'merchant' | 'contains';
  pattern: string;
  categoryId: number;
}
export interface OtherGroup {
  merchant: string;
  count: number;
  totalCents: number;
  platform: boolean;
  sampleDescription: string;
  /** The bank's own category for these rows (Amex "Restaurant-Restaurant"), when the statement had one. */
  bankCategory?: string | null;
  /** The category that bank category points to here. */
  suggestedCategoryId?: number | null;
}
export type FtTarget = { kind: 'existing'; value: number } | { kind: 'new'; value: string };
export interface FtProposal {
  merchant: string;
  ftCategory: string;
  target: FtTarget;
  moves: number;
}
export interface FtChoice {
  merchant: string;
  target: FtTarget;
}
export interface FtReport {
  learned: number;
  moved: number;
  created: number;
}

/** Notification center (mirrors crates/core/src/notifications.rs). */
export type NotificationKind =
  | 'update'
  | 'billUpcoming'
  | 'billMissed'
  | 'priceUp'
  | 'doubleCharge'
  | 'largeTransaction'
  | 'overBudget'
  | 'monthlyRecap'
  | 'reviewDigest'
  | 'moneyIn'
  | 'possibleDuplicates';

/** Where clicking a notification goes. */
export type NotificationTarget =
  | { kind: 'update' }
  | { kind: 'recurring'; id: number }
  | { kind: 'transaction'; id: number }
  | { kind: 'category'; id: number | null; month: string }
  | { kind: 'transactions'; filter: 'review' | 'search' | 'duplicates'; text?: string };

export interface NewNotification {
  key: string;
  kind: NotificationKind;
  title: string;
  body: string;
  target: NotificationTarget;
  profileId: number | null;
}

export interface AppNotification extends NewNotification {
  id: number;
  createdAt: string;
  read: boolean;
  delivered: boolean;
}

/** A past import, for the Import page's Recent imports (mirrors imports.rs). */
export interface ImportRecord {
  id: number;
  sourceId: number;
  sourceName: string;
  fileName: string;
  importedAt: string;
  importedRows: number;
  skippedRows: number;
  /** Rows from this file still present. */
  remaining: number;
}
