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
  /** Card, checking or savings (null until you say). */
  accountType?: AccountType | null;
  color?: string | null;
  /** Put on every transaction imported into this account. */
  defaultTagId?: number | null;
}

export type AccountType = 'card' | 'checking' | 'savings';

/** What a statement says about its account (crates/core/src/import/clues.rs). */
export interface StatementClues {
  last4: string | null;
  bank: string | null;
  layout: string | null;
  folder: string | null;
}

export interface NewAccount {
  name: string;
  institution: string | null;
  accountType: AccountType | null;
  color: string | null;
  defaultTagId: number | null;
}

/** What an account is recognized by: "last4" ("<bank>|1004") or "layout" (a file layout). */
export interface AccountClue {
  id: number;
  kind: 'last4' | 'layout';
  value: string;
}

/** Changes to an account (left out: unchanged; null: cleared). */
export interface AccountPatch {
  name?: string;
  institution?: string | null;
  accountType?: AccountType | null;
  color?: string | null;
}

/** A file that may be a statement, found in the watched folder or Downloads. */
export interface StatementCandidate {
  path: string;
  name: string;
  modifiedMs: number;
  size: number;
  from: 'watched' | 'downloads';
}

export interface MoveReport {
  moved: number;
  /** Rows the account already had, removed instead of moved. */
  dropped: number;
}

/** Your answer to "Which account is this?". */
export type AccountChoice =
  | { kind: 'existing'; sourceId: number; remember: boolean }
  | { kind: 'new'; account: NewAccount; remember: boolean };

/** The import paused: which account is this file? */
export interface NeedsAccount {
  clues: StatementClues;
  /** The likeliest account, listed first. */
  guess: number | null;
  suggestedName: string;
  preview: {
    rows: number;
    first: string | null;
    last: string | null;
    sample: { postedOn: string; description: string; amountCents: number }[];
  };
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
  /** A need (rent, groceries, bills you can't skip) rather than a want. */
  essential?: boolean;
}

export interface Transaction {
  /** The amount and currency it was imported in, when shown converted to the display currency. */
  originalAmountCents?: number | null;
  originalCurrency?: string | null;
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
  /** Where the category came from; automatic changes never touch 'user'. Absent means 'keyword'. */
  categorySource?: CategorySource;
  /** Why an automatic category was chosen. */
  categoryReason?: string | null;
  /** A category to check, and why. */
  suggestedCategoryId?: number | null;
  suggestedReason?: string | null;
  /** The other side of a transfer between your own accounts. */
  transferPairId?: number | null;
}

export type CategorySource = 'user' | 'rule' | 'learned' | 'model' | 'transfer' | 'bank' | 'keyword';

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
  /** Only rows with (or without) a suggested category to check. */
  suggested?: boolean;
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

/** biennial, triennial, quadrennial: every 2, 3 and 4 years (multi-year subscriptions). */
export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly' | 'biennial' | 'triennial' | 'quadrennial';

/** A charge that may be a bill at a new price, asked about once (amounts are positive cents). */
export interface PriceCheck {
  id: number;
  txId: number;
  recurringId: number;
  oldCents: number;
  newCents: number;
  direction: 'up' | 'down';
  answered: boolean;
}
/** "Is this the same subscription at a new price?" */
export type PriceAnswer = 'new_price' | 'one_off' | 'separate';
/** One change in a bill's price, on the day of its first charge at the new price. */
export interface PriceChange {
  changedOn: string;
  fromCents: number;
  toCents: number;
}
export interface BillPriceChange extends PriceChange {
  recurringId: number;
}

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
  /** Other names it matches the same way (its statement name changed over time). */
  alsoMatches?: string[];
  /** Names of credits that pay it back; null = never decided, [] = not paid back. */
  paidBackBy?: string[] | null;
}

export interface SavedRecurring extends NewRecurring {
  id: number;
  status: RecurringStatus;
  createdOn: string;
  alsoMatches: string[];
  paidBackBy: string[] | null;
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
  essential?: boolean;
}

/** What the Edit menu shows next to Undo and Redo. */
export interface UndoState {
  undo: string | null;
  redo: string | null;
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
  /** The account the file went into (0 when it is still waiting for one). */
  sourceId?: number;
  sourceName: string;
  inserted: number;
  duplicates: number;
  skipped: number;
  alreadyImported: boolean;
  /** Rows tagged "Possible duplicate" by this import. */
  flags?: DuplicateFlag[];
  /** Set when the account couldn't be recognized: nothing was imported yet. */
  needsAccount?: NeedsAccount | null;
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
  | 'possibleDuplicates'
  | 'statements'
  | 'moneyTips';

/** Where clicking a notification goes. */
export type NotificationTarget =
  | { kind: 'update' }
  | { kind: 'recurring'; id: number }
  | { kind: 'transaction'; id: number }
  | { kind: 'category'; id: number | null; month: string }
  | { kind: 'transactions'; filter: 'review' | 'search' | 'duplicates' | 'suggested'; text?: string }
  | { kind: 'import' }
  | { kind: 'insights' };

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

/** Everything "Your money habits" needs from all of history (crates/core/src/habits.rs). */
export interface HabitMonth {
  month: string;
  incomeCents: number;
  spendCents: number;
  essentialCents: number;
  toSavingsCents: number;
}
export interface FlexMonth {
  categoryId: number;
  month: string;
  cents: number;
}
export interface DaySpend {
  day: string;
  cents: number;
}
export interface MerchantStat {
  name: string;
  visits: number;
  totalCents: number;
}
export interface HabitsData {
  firstMonth: string | null;
  currentMonth: string;
  months: HabitMonth[];
  flexible: FlexMonth[];
  daysThisMonth: DaySpend[];
  merchants: MerchantStat[];
  billsRaisedLast12: number;
}

/** What a category change did to the rest of history. */
export interface CategoryChange {
  /** Other rows from the same merchant that moved with it. */
  moved: number;
  merchant: string;
  /** Rows from similar merchants that got it as a suggestion. */
  suggested: number;
  /** A payment app or gas station: nothing moved; ask about the others with sameMerchant. */
  platform: boolean;
  /** The undo step this change made (for the note's Undo and Only this one); null when nothing changed. */
  step: number | null;
}
