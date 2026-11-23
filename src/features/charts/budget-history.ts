// Per-category budget history data: what was spent each month against that month's budget.

export interface BudgetMonth {
  month: string; // YYYY-MM
  spentCents: number;
  budgetCents: number | null;
}

const INITIALS = 'JFMAMJJASOND';

export function monthInitial(month: string): string {
  return INITIALS[Number(month.slice(5, 7)) - 1] ?? '';
}
