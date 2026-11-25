import { incomeOf, isRegular, spendOf, txTypeOf } from '@/lib/tx-type';
// Everything the Copilot-style Categories screen shows: the ring summary, the
// group/category tree, and the detail panel for the current selection.

import type { BudgetPlan, Recurring, Category, CategoryGroup, Transaction } from '@/lib/types';
import { trendFrom, type SpendTrend } from './spend-trend';
import { budgetsForMonth, rolloverCents, type RebalanceLine } from '@/lib/budget-plan';
import { dueCharges } from '@/lib/recurring-due';
import { normalizedName } from '@/lib/category-names';

export type Selection = { kind: 'all' } | { kind: 'group'; id: number } | { kind: 'category'; id: number };

export interface CatLine {
  category: Category;
  spentCents: number;
  budgetCents: number | null;
  /** Active bills due this month and not paid yet (outlined in the bar). */
  expectedCents: number;
  /** Carried in from earlier months (rollovers on), negative after overspending. */
  rolloverCents: number;
}
export interface GroupLine {
  group: CategoryGroup;
  spentCents: number;
  budgetCents: number | null;
  expectedCents: number;
  rolloverCents: number;
  /** The group has its own shared budget (its categories have none). */
  shared: boolean;
  children: CatLine[];
}
export interface Member {
  name: string;
  emoji: string | null;
  color: string;
}
export interface Row extends Member {
  depth: number;
  spentCents: number;
  budgetCents: number | null;
  leftCents: number | null;
  rolloverCents: number;
  selection: Selection;
}
export interface Detail {
  title: string;
  members: Member[];
  spentCents: number;
  budgetCents: number | null;
  leftCents: number | null;
  rolloverCents: number;
  /** The month the detail shows ('YYYY-MM'): this month, or one picked on the chart. */
  month: string;
  /** A single category's transactions by month, newest first (only the picked month when one is picked). */
  transactionsByMonth: { month: string; transactions: Transaction[] }[];
  history: { month: string; spentCents: number; budgetCents: number | null }[];
  years: { year: number; spendCents: number; avgMonthlySpendCents: number }[];
  rows: Row[];
}
export interface CategoriesModel {
  summary: { spentCents: number; budgetCents: number; expectedCents: number };
  /** Regular spending: each of the last 12 months, and this month and year against the last. */
  trend: SpendTrend;
  tree: GroupLine[];
  excluded: CatLine[];
  /** Income categories: this month's income in `spentCents`, never budgeted. */
  income: CatLine[];
  detail: Detail;
  /** Budgeted categories (not under a shared group budget), for Rebalance. */
  rebalanceLines: RebalanceLine[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

const sumBudgets = (lines: { budgetCents: number | null }[]): number | null => {
  const withBudget = lines.filter((l) => l.budgetCents != null);
  return withBudget.length ? withBudget.reduce((s, l) => s + (l.budgetCents as number), 0) : null;
};

export function buildCategories(input: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  today: string;
  selection: Selection;
  /** Saved recurring bills, for expected spending this month. */
  recurring?: Recurring[];
  /** Month overrides, shared group budgets and rollovers; absent means defaults only. */
  plan?: BudgetPlan;
  /** Settings > Rollovers: carry leftovers forward for categories set to roll over. */
  rolloversOn?: boolean;
  /** A month picked on the history chart ('YYYY-MM'); the detail shows it. Default: this month. */
  month?: string;
}): CategoriesModel {
  const { transactions, today, selection } = input;
  const plan: BudgetPlan = input.plan ?? { months: [], groups: [], rollovers: [] };
  const groups = input.groups;
  const [y, m, day] = today.split('-').map(Number);
  const thisMonth = `${y}-${pad(m)}`;
  // Categories carry this month's budgets: overrides win, shared group members have none.
  const forMonth = (month: string) => budgetsForMonth(plan, input.categories, month);
  const now = forMonth(thisMonth);
  const categories = now.categories;

  // Per category per month: spending for Regular rows (net of refunds), income for Income rows,
  // money moved for transfers (shown only under Excluded).
  const spend = new Map<number, Map<string, number>>();
  for (const t of transactions) {
    if (t.categoryId == null || t.postedOn > today) continue;
    const byMonth = spend.get(t.categoryId) ?? new Map<string, number>();
    const key = t.postedOn.slice(0, 7);
    const value = isRegular(t) ? spendOf(t) : txTypeOf(t) === 'income' ? incomeOf(t) : -t.amountCents;
    byMonth.set(key, (byMonth.get(key) ?? 0) + value);
    spend.set(t.categoryId, byMonth);
  }
  const spentIn = (ids: number[], month: string) => ids.reduce((s, id) => s + (spend.get(id)?.get(month) ?? 0), 0);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const colorOf = (c: Category) => c.color ?? groupById.get(c.groupId)?.color ?? '#77a5f2';
  // Active bills due this month and not paid yet (paying moves next date past this month).
  const expected = new Map<number, number>();
  for (const r of input.recurring ?? []) {
    if (r.saved?.status !== 'active' || r.categoryId == null || !r.nextDate.startsWith(thisMonth)) continue;
    // A weekly bill can still be due several times this month.
    const times = Math.max(1, dueCharges(r, today, `${thisMonth}-31`));
    expected.set(r.categoryId, (expected.get(r.categoryId) ?? 0) + times * r.typicalAmountCents);
  }
  const expectedIn = (ids: number[]) => ids.reduce((s, id) => s + (expected.get(id) ?? 0), 0);
  const rollIn = (id: number, month: string) => (input.rolloversOn ? rolloverCents(plan, input.categories, id, month, (mo) => spentIn([id], mo)) : 0);
  // A category's line for a month. Bills still due only count for this month.
  const lineFor =
    (month: string) =>
    (c: Category): CatLine => ({
      category: c,
      spentCents: spentIn([c.id], month),
      budgetCents: c.budgetCents,
      expectedCents: month === thisMonth ? expectedIn([c.id]) : 0,
      rolloverCents: c.budgetCents == null ? 0 : rollIn(c.id, month),
    });
  const line = lineFor(thisMonth);

  const regular = categories
    .filter((c) => c.kind === 'expense' && !c.excluded && !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  // The group/category tree with a month's spending and budgets.
  const treeFor = (month: string): GroupLine[] => {
    const mc = month === thisMonth ? now : forMonth(month);
    const lineOf = lineFor(month);
    return [...groups]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((group) => {
        const children = mc.categories
          .filter((c) => c.kind === 'expense' && !c.excluded && !c.archived && c.groupId === group.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(lineOf);
        const shared = mc.sharedGroups.has(group.id);
        return {
          group,
          children,
          shared,
          spentCents: children.reduce((s, c) => s + c.spentCents, 0),
          budgetCents: shared ? (mc.groupBudgets.get(group.id) ?? null) : sumBudgets(children),
          expectedCents: children.reduce((s, c) => s + c.expectedCents, 0),
          rolloverCents: children.reduce((s, c) => s + c.rolloverCents, 0),
        };
      })
      .filter((g) => g.children.length > 0);
  };
  const tree = treeFor(thisMonth);
  const excluded = categories.filter((c) => c.excluded && !c.archived).map(line);
  const income = categories.filter((c) => c.kind === 'income' && !c.excluded && !c.archived).map(line);

  const summary = {
    spentCents: tree.reduce((s, g) => s + g.spentCents, 0),
    budgetCents: tree.reduce((s, g) => s + (g.budgetCents ?? 0), 0),
    expectedCents: tree.reduce((s, g) => s + g.expectedCents, 0),
  };

  // Spending in regular categories by day, the same rows the summary counts.
  const regularIds = new Set(regular.map((c) => c.id));
  const trend = trendFrom(
    transactions
      .filter((t) => t.categoryId != null && regularIds.has(t.categoryId) && isRegular(t) && t.postedOn <= today)
      .map((t) => ({ day: t.postedOn, cents: spendOf(t) })),
    today,
  );

  // The detail shows the picked month (never a future one), else this month.
  const focus = input.month && input.month <= thisMonth ? input.month : thisMonth;
  const dTree = focus === thisMonth ? tree : treeFor(focus);
  const dLine = lineFor(focus);
  const dCategories = focus === thisMonth ? categories : forMonth(focus).categories;

  // The selection's categories, title, pills and table rows.
  const row = (name: string, emoji: string | null, color: string, depth: number, l: { spentCents: number; budgetCents: number | null; expectedCents: number; rolloverCents: number }, sel: Selection): Row => ({
    name,
    emoji,
    color,
    depth,
    spentCents: l.spentCents,
    budgetCents: l.budgetCents,
    leftCents: l.budgetCents == null ? null : l.budgetCents + l.rolloverCents - l.spentCents - l.expectedCents,
    rolloverCents: l.rolloverCents,
    selection: sel,
  });
  const catRow = (c: CatLine, depth: number) => row(c.category.name, c.category.emoji, colorOf(c.category), depth, c, { kind: 'category', id: c.category.id });

  let title = 'All categories';
  let ids: number[] = regular.map((c) => c.id);
  let members: Member[] = dTree.map((g) => ({ name: g.group.name, emoji: g.group.emoji, color: g.group.color }));
  let rows: Row[] = dTree.flatMap((g) =>
    // A category alone in a group of its own name is top-level: one row.
    g.children.length === 1 && normalizedName(g.children[0].category.name) === normalizedName(g.group.name)
      ? [catRow(g.children[0], 0)]
      : [row(g.group.name, g.group.emoji, g.group.color, 0, g, { kind: 'group', id: g.group.id }), ...g.children.map((c) => catRow(c, 1))],
  );
  const dBudget = dTree.reduce((s, g) => s + (g.budgetCents ?? 0), 0);
  let budgetCents: number | null = dBudget > 0 ? dBudget : null;
  let rollover = dTree.reduce((s, g) => s + g.rolloverCents, 0);
  // The selection's budget in any month (for the history's step line).
  let budgetIn = (month: string): number | null => {
    const mc = forMonth(month);
    const total = tree.reduce((s, g) => {
      if (mc.sharedGroups.has(g.group.id)) return s + (mc.groupBudgets.get(g.group.id) ?? 0);
      return s + g.children.reduce((t, c) => t + (mc.categories.find((x) => x.id === c.category.id)?.budgetCents ?? 0), 0);
    }, 0);
    return total > 0 ? total : null;
  };

  if (selection.kind === 'group') {
    const g = dTree.find((x) => x.group.id === selection.id);
    title = g?.group.name ?? 'Group';
    ids = g?.children.map((c) => c.category.id) ?? [];
    members = g?.children.map((c) => ({ name: c.category.name, emoji: c.category.emoji, color: colorOf(c.category) })) ?? [];
    rows = g?.children.map((c) => catRow(c, 0)) ?? [];
    budgetCents = g?.budgetCents ?? null;
    rollover = g?.rolloverCents ?? 0;
    budgetIn = (month) => {
      if (!g) return null;
      const mc = forMonth(month);
      if (mc.sharedGroups.has(g.group.id)) return mc.groupBudgets.get(g.group.id) ?? null;
      return sumBudgets(g.children.map((c) => ({ budgetCents: mc.categories.find((x) => x.id === c.category.id)?.budgetCents ?? null })));
    };
  } else if (selection.kind === 'category') {
    const c = dCategories.find((x) => x.id === selection.id);
    title = c?.name ?? 'Category';
    ids = c ? [c.id] : [];
    members = c ? [{ name: c.name, emoji: c.emoji, color: colorOf(c) }] : [];
    const l = c ? dLine(c) : null;
    rows = l ? [catRow(l, 0)] : [];
    budgetCents = c?.budgetCents ?? null;
    rollover = l?.rolloverCents ?? 0;
    budgetIn = (month) => (c ? (forMonth(month).categories.find((x) => x.id === c.id)?.budgetCents ?? null) : null);
  }

  const transactionsByMonth: { month: string; transactions: Transaction[] }[] = [];
  if (selection.kind === 'category') {
    const own = input.transactions
      .filter((t) => t.categoryId === selection.id && (focus === thisMonth || t.postedOn.startsWith(focus)) && t.postedOn <= input.today)
      .sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.id - a.id);
    for (const t of own) {
      const month = t.postedOn.slice(0, 7);
      const last = transactionsByMonth[transactionsByMonth.length - 1];
      if (last?.month === month) last.transactions.push(t);
      else transactionsByMonth.push({ month, transactions: [t] });
    }
  }
  const spentCents = spentIn(ids, focus);
  const expectedCents = focus === thisMonth ? expectedIn(ids) : 0;
  const history = Array.from({ length: 24 }, (_, i) => {
    const month = shiftMonth(thisMonth, i - 23);
    return { month, spentCents: spentIn(ids, month), budgetCents: month === focus ? budgetCents : budgetIn(month) };
  });
  const elapsed = m - 1 + day / new Date(y, m, 0).getDate();
  const years = [y, y - 1].map((year) => {
    const spendCents = Array.from({ length: 12 }, (_, i) => spentIn(ids, `${year}-${pad(i + 1)}`)).reduce((s, v) => s + v, 0);
    return { year, spendCents, avgMonthlySpendCents: Math.round(spendCents / (year === y ? elapsed : 12)) };
  });

  // Rebalance: budgeted categories outside shared group budgets, with a typical month
  // (average of the last three complete months).
  const typical = (id: number) => Math.round([1, 2, 3].reduce((s, k) => s + spentIn([id], shiftMonth(thisMonth, -k)), 0) / 3);
  const rebalanceLines: RebalanceLine[] = tree
    .filter((g) => !g.shared)
    .flatMap((g) => g.children)
    .filter((c) => c.budgetCents != null)
    .map((c) => ({ categoryId: c.category.id, budgetCents: c.budgetCents as number, spentCents: c.spentCents, expectedCents: c.expectedCents, typicalCents: typical(c.category.id) }));

  return {
    summary,
    trend,
    tree,
    excluded,
    income,
    detail: {
      title,
      members,
      spentCents,
      budgetCents,
      leftCents: budgetCents == null ? null : budgetCents + rollover - spentCents - expectedCents,
      rolloverCents: rollover,
      month: focus,
      transactionsByMonth,
      history,
      years,
      rows,
    },
    rebalanceLines,
  };
}
