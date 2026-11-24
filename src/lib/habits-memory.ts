// The in-memory twin of crates/core/src/habits.rs: everything "Your money habits" needs, from rows already shown in
// the display currency.

import type { BillPriceChange, Category, HabitsData, SavedRecurring, Source, Transaction } from './types';
import { incomeOf, isRegular, spendOf, txTypeOf } from './tx-type';
import { shiftMonths } from './analytics';

export const MIN_VISITS = 24;

export interface HabitsInput {
  transactions: Transaction[];
  children: Map<number, Transaction[]>;
  categories: Category[];
  sources: Source[];
  bills: Pick<SavedRecurring, 'id' | 'status'>[];
  prices: Pick<BillPriceChange, 'changedOn' | 'fromCents' | 'toCents'>[];
  today: string;
  profileId?: number | null;
}

const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

export function moneyHabitsFrom(input: HabitsInput): HabitsData {
  const { today } = input;
  const currentMonth = today.slice(0, 7);
  const mine = (t: Transaction) => (input.profileId == null || t.profileId === input.profileId) && t.postedOn <= today;
  const top = input.transactions.filter(mine);
  const leaves = top.flatMap((t) => {
    const kids = input.children.get(t.id);
    return kids && kids.length ? kids : [t];
  });
  const cats = new Map(input.categories.map((c) => [c.id, c]));
  const excluded = (t: Transaction) => t.categoryId != null && !!cats.get(t.categoryId)?.excluded;
  const activeBills = new Set(input.bills.filter((b) => b.status === 'active').map((b) => b.id));
  const onBill = (t: Transaction) => t.recurringId != null && activeBills.has(t.recurringId);
  const savings = new Set(input.sources.filter((s) => s.accountType === 'savings').map((s) => s.id));

  const firstMonth = top.length ? top.reduce((m, t) => (t.postedOn < m ? t.postedOn : m), top[0].postedOn).slice(0, 7) : null;

  const income = new Map<string, number>();
  const spend = new Map<string, number>();
  const needs = new Map<string, number>();
  const saved = new Map<string, number>();
  for (const t of top) {
    const m = t.postedOn.slice(0, 7);
    if (!excluded(t)) {
      add(income, m, incomeOf(t));
      add(spend, m, spendOf(t));
    }
    if (txTypeOf(t) === 'transfer' && t.amountCents > 0 && savings.has(t.sourceId)) add(saved, m, t.amountCents);
  }
  const flex = new Map<string, number>();
  const days = new Map<string, number>();
  const yearAgo = shiftDays(today, -365);
  const merchants = new Map<string, { visits: number; total: number }>();
  for (const t of leaves) {
    if (!isRegular(t) || excluded(t)) continue;
    const m = t.postedOn.slice(0, 7);
    const c = t.categoryId != null ? cats.get(t.categoryId) : undefined;
    if (c?.essential || onBill(t)) add(needs, m, spendOf(t));
    else if (c && c.kind === 'expense') add(flex, `${c.id}|${m}`, spendOf(t));
    if (!onBill(t) && m === currentMonth) add(days, t.postedOn, spendOf(t));
    if (t.amountCents < 0 && t.postedOn > yearAgo && t.merchant) {
      const s = merchants.get(t.merchant) ?? { visits: 0, total: 0 };
      s.visits += 1;
      s.total += -t.amountCents;
      merchants.set(t.merchant, s);
    }
  }

  const months = [];
  if (firstMonth) {
    for (let m = firstMonth; m <= currentMonth; m = shiftMonths(`${m}-01`, 1).slice(0, 7)) {
      months.push({ month: m, incomeCents: income.get(m) ?? 0, spendCents: spend.get(m) ?? 0, essentialCents: needs.get(m) ?? 0, toSavingsCents: saved.get(m) ?? 0 });
    }
  }
  return {
    firstMonth,
    currentMonth,
    months,
    flexible: [...flex.entries()]
      .filter(([, cents]) => cents !== 0)
      .map(([k, cents]) => ({ categoryId: Number(k.split('|')[0]), month: k.split('|')[1], cents }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.categoryId - b.categoryId),
    daysThisMonth: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, cents]) => ({ day, cents })),
    merchants: [...merchants.entries()]
      .filter(([, s]) => s.visits >= MIN_VISITS)
      .map(([name, s]) => ({ name, visits: s.visits, totalCents: s.total }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10),
    billsRaisedLast12: input.prices.filter((p) => p.toCents > p.fromCents && p.changedOn > yearAgo && p.changedOn <= today).length,
  };
}

function shiftDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
