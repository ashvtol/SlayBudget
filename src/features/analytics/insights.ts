// Pure insight derivation from loaded analytics, so the Insights screen stays
// a dumb renderer and the logic is unit-tested.

import type { BudgetStatus, CashFlow, Category, CategoryTotal, MonthlyTotal, Recurring } from '@/lib/types';

export interface Insight {
  id: string;
  tone: 'good' | 'warn' | 'info';
  title: string;
  detail: string;
}

interface Input {
  monthly: MonthlyTotal[];
  categories: CategoryTotal[];
  budgets: BudgetStatus[];
  cashflow: CashFlow | null;
  recurring: Recurring[];
  categoryMeta: Record<number, Category>;
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(cents) / 100);
}

export function deriveInsights(input: Input): Insight[] {
  const { categories, budgets, cashflow, recurring, categoryMeta } = input;
  const out: Insight[] = [];

  if (cashflow) {
    const { netDeltaCents, current } = cashflow;
    if (current.netCents < 0) {
      out.push({ id: 'net-negative', tone: 'warn', title: 'Spending outpaced income', detail: `You were ${money(current.netCents)} in the red this period.` });
    } else if (netDeltaCents > 0) {
      out.push({ id: 'net-up', tone: 'good', title: 'Net improved', detail: `Up ${money(netDeltaCents)} versus the previous period.` });
    } else if (netDeltaCents < 0) {
      out.push({ id: 'net-down', tone: 'info', title: 'Net slipped', detail: `Down ${money(netDeltaCents)} versus the previous period.` });
    }
  }

  const top = categories[0];
  if (top && top.categoryId != null) {
    const name = categoryMeta[top.categoryId]?.name ?? 'a category';
    out.push({ id: 'top-category', tone: 'info', title: `${name} is your biggest expense`, detail: `${money(top.totalCents)} across ${top.count} transaction${top.count === 1 ? '' : 's'}.` });
  }

  const over = budgets.filter((b) => b.overBudget);
  if (over.length) {
    const names = over.map((b) => categoryMeta[b.categoryId]?.name ?? 'a category').slice(0, 3).join(', ');
    out.push({ id: 'over-budget', tone: 'warn', title: `${over.length} ${over.length === 1 ? 'budget' : 'budgets'} over`, detail: `Over in ${names}.` });
  }

  const projectedOver = budgets.filter((b) => !b.overBudget && b.projectedCents > b.budgetCents);
  if (projectedOver.length) {
    const names = projectedOver.map((b) => categoryMeta[b.categoryId]?.name ?? 'a category').slice(0, 3).join(', ');
    out.push({ id: 'projected-over', tone: 'warn', title: `On track to overspend`, detail: `At the current pace, ${names} will exceed budget this month.` });
  }

  if (recurring.length) {
    const monthly = recurring.filter((r) => r.cadence === 'monthly').reduce((s, r) => s + r.typicalAmountCents, 0);
    if (monthly > 0) {
      out.push({ id: 'subscriptions', tone: 'info', title: `${recurring.length} recurring charges`, detail: `About ${money(monthly)}/month in subscriptions.` });
    }
  }

  return out;
}
