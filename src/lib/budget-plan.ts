import type { BudgetPlan, Category } from './types';

/** Categories with the budget they have in `month`, and the shared group budgets. */
export function budgetsForMonth(plan: BudgetPlan, categories: Category[], month: string) {
  const overrides = new Map(plan.months.filter((m) => m.month === month).map((m) => [m.categoryId, m.amountCents]));
  const groupBudgets = new Map(plan.groups.map((g) => [g.groupId, g.amountCents]));
  const sharedGroups = new Set(groupBudgets.keys());
  return {
    categories: categories.map((c) => ({
      ...c,
      // A category under a shared group budget has none of its own this month.
      budgetCents: sharedGroups.has(c.groupId) ? null : (overrides.get(c.id) ?? c.budgetCents),
    })),
    groupBudgets,
    sharedGroups,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
}

/** The category's budget in a month: override, else default. */
function budgetOf(plan: BudgetPlan, category: Category, month: string): number {
  return plan.months.find((m) => m.categoryId === category.id && m.month === month)?.amountCents ?? category.budgetCents ?? 0;
}

/**
 * What a category carries into `month`: the sum of (budget - spent) for each month from the
 * month its rollover began up to the month before. Negative when it overspent.
 */
export function rolloverCents(plan: BudgetPlan, categories: Category[], categoryId: number, month: string, spentIn: (month: string) => number): number {
  const start = plan.rollovers.find((r) => r.categoryId === categoryId)?.since;
  const category = categories.find((c) => c.id === categoryId);
  if (!start || !category || start >= month) return 0;
  let total = 0;
  for (let m = start; m < month; m = nextMonth(m)) total += budgetOf(plan, category, m) - spentIn(m);
  return total;
}

export interface RebalanceLine {
  categoryId: number;
  budgetCents: number;
  spentCents: number;
  /** Bills due this month and not paid yet. */
  expectedCents: number;
  /** A typical month's spending (average of recent complete months). */
  typicalCents: number;
}

export interface RebalanceChange {
  categoryId: number;
  fromCents: number;
  toCents: number;
}

/** Share `total` whole dollars in proportion to `weights` (largest remainder), as cents. */
function share(totalDollars: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (sum > 0 ? (totalDollars * w) / sum : 0));
  const dollars = exact.map(Math.floor);
  let left = totalDollars - dollars.reduce((s, d) => s + d, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    dollars[i]++;
    left--;
  }
  return dollars.map((d) => d * 100);
}

/**
 * Copilot's Rebalance: each line is on track for the larger of (spent + unpaid bills) and a
 * typical month. Lines heading over get more, lines with spare give some; the amount moved is
 * the smaller of total need and total spare, in whole dollars, so the total never changes.
 */
export function proposeRebalance(lines: RebalanceLine[]): RebalanceChange[] {
  const heading = lines.map((l) => Math.max(l.spentCents + l.expectedCents, l.typicalCents));
  const need = lines.map((l, i) => Math.max(0, heading[i] - l.budgetCents));
  const spare = lines.map((l, i) => Math.max(0, l.budgetCents - heading[i]));
  const moveDollars = Math.floor(Math.min(need.reduce((s, v) => s + v, 0), spare.reduce((s, v) => s + v, 0)) / 100);
  if (moveDollars <= 0) return [];
  const up = share(moveDollars, need);
  const down = share(moveDollars, spare);
  return lines
    .map((l, i) => ({ categoryId: l.categoryId, fromCents: l.budgetCents, toCents: l.budgetCents + up[i] - down[i] }))
    .filter((c) => c.toCents !== c.fromCents);
}
