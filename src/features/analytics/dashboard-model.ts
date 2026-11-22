import { incomeOf, isRegular, spendOf } from '@/lib/tx-type';
// Everything the Copilot-style dashboard shows, computed from this month's and
// last month's transactions. Pure so it can be tested without the UI.

import type { BudgetPlan, Category, CategoryGroup, Recurring, Transaction } from '@/lib/types';
import { budgetsForMonth } from '@/lib/budget-plan';
import { dueCharges } from '@/lib/recurring-due';

export interface TopChild {
  category: Category;
  spentCents: number;
  budgetCents: number | null;
}

export interface TopGroup {
  group: CategoryGroup;
  spentCents: number;
  budgetCents: number | null;
  children: TopChild[];
}

export interface DashboardModel {
  /**
   * Copilot's "Free to spend": this month's recurring bills (paid or still due) are set aside, and
   * `daily` is the cumulative spend outside them, measured against what's left of the budget.
   */
  month: {
    spentCents: number;
    budgetCents: number;
    leftCents: number;
    daily: number[];
    daysInMonth: number;
    billsCents: number;
    freeBudgetCents: number;
    freeLeftCents: number;
  };
  net: { incomeCents: number; spendCents: number; netCents: number; previousNetCents: number; previousLabel: string };
  topCategories: TopGroup[];
  upcoming: Recurring[];
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function buildDashboard(input: {
  transactions: Transaction[];
  categories: Category[];
  groups: CategoryGroup[];
  recurring: Recurring[];
  today: string;
  /** Month overrides and shared group budgets; absent means defaults only. */
  plan?: BudgetPlan;
}): DashboardModel {
  const { transactions, groups, recurring, today } = input;
  const [y, m, dayOfMonth] = today.split('-').map(Number);
  const month = budgetsForMonth(input.plan ?? { months: [], groups: [], rollovers: [] }, input.categories, today.slice(0, 7));
  const categories = month.categories;
  const monthStart = `${y}-${pad(m)}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();

  const excluded = new Set(categories.filter((c) => c.excluded).map((c) => c.id));
  const counted = transactions.filter((t) => t.categoryId == null || !excluded.has(t.categoryId));
  const thisMonth = counted.filter((t) => t.postedOn >= monthStart && t.postedOn <= today);

  // Monthly spending: cumulative money out per day, leaving out recurring bills.
  const perDay = new Array<number>(dayOfMonth).fill(0);
  let income = 0;
  let paidBills = 0;
  for (const t of thisMonth) {
    if (t.recurringId != null) paidBills += spendOf(t);
    else perDay[Number(t.postedOn.slice(8, 10)) - 1] += spendOf(t);
    income += incomeOf(t);
  }
  const monthEnd = `${y}-${pad(m)}-${pad(daysInMonth)}`;
  const dueBills = recurring
    .filter((r) => r.saved?.status !== 'paused' && r.saved?.status !== 'archived')
    .reduce((s, r) => s + dueCharges(r, today, monthEnd) * Math.abs(r.typicalAmountCents), 0);
  const billsCents = paidBills + dueBills;
  const daily: number[] = [];
  perDay.reduce((acc, v) => {
    daily.push(acc + v);
    return acc + v;
  }, 0);
  const flexibleSpent = daily[daily.length - 1] ?? 0;
  const spentCents = flexibleSpent + paidBills;
  const counting = categories.filter((c) => !c.excluded && !c.archived && c.kind === 'expense');
  // Shared group budgets count once, for groups with a counting category.
  const sharedTotal = [...month.groupBudgets].filter(([gid]) => counting.some((c) => c.groupId === gid)).reduce((s, [, v]) => s + v, 0);
  const budgetCents = counting.reduce((s, c) => s + (c.budgetCents ?? 0), 0) + sharedTotal;

  // Net vs the same days of last month.
  const prevYear = m === 1 ? y - 1 : y;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevStart = `${prevYear}-${pad(prevMonth)}-01`;
  const prevDays = Math.min(dayOfMonth, new Date(prevYear, prevMonth, 0).getDate());
  const prevEnd = `${prevYear}-${pad(prevMonth)}-${pad(prevDays)}`;
  const previousNetCents = counted
    .filter((t) => t.postedOn >= prevStart && t.postedOn <= prevEnd)
    .reduce((s, t) => s + t.amountCents, 0);
  const mon = SHORT_MONTHS[prevMonth - 1];

  // Top categories: this month's spend by group, with budgeted categories kept even at zero.
  const spentBy = new Map<number, number>();
  for (const t of thisMonth) {
    if (isRegular(t) && t.categoryId != null) spentBy.set(t.categoryId, (spentBy.get(t.categoryId) ?? 0) + spendOf(t));
  }
  const topCategories: TopGroup[] = [];
  for (const group of groups) {
    const children = counting
      .filter((c) => c.groupId === group.id)
      .map((category) => ({ category, spentCents: spentBy.get(category.id) ?? 0, budgetCents: category.budgetCents }))
      .filter((c) => c.spentCents > 0 || (c.budgetCents ?? 0) > 0)
      .sort((a, b) => b.spentCents - a.spentCents);
    if (children.length === 0) continue;
    const budgets = children.filter((c) => c.budgetCents != null);
    topCategories.push({
      group,
      spentCents: children.reduce((s, c) => s + c.spentCents, 0),
      budgetCents: month.sharedGroups.has(group.id) ? (month.groupBudgets.get(group.id) ?? null) : budgets.length ? budgets.reduce((s, c) => s + (c.budgetCents as number), 0) : null,
      children,
    });
  }
  topCategories.sort((a, b) => b.spentCents - a.spentCents || a.group.sortOrder - b.group.sortOrder);

  const horizon = addDays(today, 14);
  const upcoming = recurring
    .filter((r) => r.categoryId == null || !excluded.has(r.categoryId))
    .filter((r) => r.nextDate >= today && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));

  return {
    month: {
      spentCents,
      budgetCents,
      leftCents: budgetCents - spentCents,
      daily,
      daysInMonth,
      billsCents,
      freeBudgetCents: Math.max(0, budgetCents - billsCents),
      freeLeftCents: Math.max(0, budgetCents - billsCents) - flexibleSpent,
    },
    net: {
      incomeCents: income,
      spendCents: spentCents,
      netCents: income - spentCents,
      previousNetCents,
      previousLabel: `${mon} 1 - ${mon} ${prevDays}, ${prevYear}`,
    },
    topCategories,
    upcoming,
  };
}
