// "Your money habits": the savings rate and FIRE figures, the suggested budget and the tips, worked out from all of
// history (crates/core/src/habits.rs gathers it). Pure, so the screens only render. Rules of thumb, not advice.

import type { Category, HabitMonth, HabitsData, Recurring } from '@/lib/types';
import { localeFor } from '@/lib/format';
import { cleanMerchant } from '@/lib/merchant';

export type Style = 'fire' | 'soft';
export type Tone = 'good' | 'warn' | 'info';

export interface Split {
  needs: number;
  wants: number;
  saved: number;
}

export interface Tip {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** Where its link goes, if it has one. */
  link?: 'categories' | 'recurring';
  /** Its main number, remembered when hidden so a big change can bring it back. */
  value: number;
  split?: Split;
}

export interface HiddenTip {
  id: string;
  hiddenAt: string;
  value: number;
}

export interface HabitsContext {
  style: Style;
  /** Target savings rate, in percent. */
  target: number;
  data: HabitsData;
  categories: Category[];
  recurring: Recurring[];
  /** Whether any account is marked Savings. */
  hasSavings: boolean;
  today: string;
  currency: string;
  /** Categories you put in or left out of the suggested budget (by id); others follow the default. */
  choices?: Record<number, boolean>;
}

export interface SuggestionRow {
  categoryId: number;
  avgCents: number;
  suggestedCents: number;
  creptUp: boolean;
  /** In the budget; a left-out category keeps its average and gets no budget. */
  included: boolean;
}

export interface Suggestion {
  goalSpendCents: number;
  cutCents: number;
  rows: SuggestionRow[];
  /** When even halving flexible spending can't reach the target: the rate it does reach. */
  reachablePct: number | null;
}

export const MIN_TARGET = 5;
export const MAX_TARGET = 70;
const CREPT_UP_CENTS = 5000;
/** Categories averaging less than this a month start out of the suggested budget. */
export const SMALL_CATEGORY_CENTS = 2000;
/** Below this a month on average, a category isn't listed at all. */
const MIN_ROW_CENTS = 100;
const ROUND_TO = 500;
const PERCENT_TIPS = new Set(['rate-trend', 'split']);

// ---------- months and averages ----------

/** Months before the one in progress. */
export const completeMonths = (d: HabitsData): HabitMonth[] => d.months.filter((m) => m.month < d.currentMonth);
const lastN = (ms: HabitMonth[], n: number) => ms.slice(Math.max(0, ms.length - n));
const sum = (ms: HabitMonth[], f: (m: HabitMonth) => number) => ms.reduce((s, m) => s + f(m), 0);
const avg = (ms: HabitMonth[], f: (m: HabitMonth) => number) => (ms.length ? sum(ms, f) / ms.length : 0);
const pct = (part: number, whole: number) => Math.round((part / whole) * 100);
const ceil5 = (x: number) => Math.ceil(x / 5) * 5;
const roundTo = (cents: number) => Math.round(cents / ROUND_TO) * ROUND_TO;

/** Complete months with income. A month with spending but no income usually means that account's statements aren't
 *  in yet (card history going back further than checking), so rates and averages leave it out. */
export const incomeMonths = (complete: HabitMonth[]) => complete.filter((m) => m.incomeCents > 0);

/** (income − spending) ÷ income over the last 12 complete months with income, in whole percent; null under 3. */
export function savingsRate(complete: HabitMonth[]): number | null {
  const ms = lastN(incomeMonths(complete), 12);
  const income = sum(ms, (m) => m.incomeCents);
  if (ms.length < 3 || income <= 0) return null;
  return pct(income - sum(ms, (m) => m.spendCents), income);
}

/** Each complete month's savings rate (null without income), the last 12. */
export function monthlyRates(complete: HabitMonth[]): (number | null)[] {
  return lastN(complete, 12).map((m) => (m.incomeCents > 0 ? pct(m.incomeCents - m.spendCents, m.incomeCents) : null));
}

export const yearlySpend = (complete: HabitMonth[]) => Math.round(avg(lastN(complete, 12), (m) => m.spendCents) * 12);
export const avgIncome = (complete: HabitMonth[]) => Math.round(avg(lastN(incomeMonths(complete), 12), (m) => m.incomeCents));
export const avgSpend = (complete: HabitMonth[]) => Math.round(avg(lastN(incomeMonths(complete), 12), (m) => m.spendCents));

// ---------- FIRE ----------

export const fiNumber = (yearly: number) => yearly * 25;
export const fiAt35 = (yearly: number) => Math.round(yearly / 0.035);

/** Years from zero to independence: saving `ratePct` of income, 5% real growth, 4% withdrawal. */
export function yearsToFi(ratePct: number): number | null {
  const s = ratePct / 100;
  if (s <= 0) return null;
  if (s >= 1) return 0;
  return Math.log(1 + (0.05 * (1 - s)) / (0.04 * s)) / Math.log(1.05);
}

export function defaultTarget(style: Style, rate: number | null): number {
  const t = style === 'fire' ? Math.max(25, ceil5((rate ?? 0) + 10)) : Math.max(20, ceil5(rate ?? 0));
  return Math.min(MAX_TARGET, t);
}

// ---------- suggested budget ----------

function flexAverages(d: HabitsData, window: HabitMonth[]): Map<number, number> {
  const inWindow = new Set(window.map((m) => m.month));
  const totals = new Map<number, number>();
  for (const f of d.flexible) if (inWindow.has(f.month)) totals.set(f.categoryId, (totals.get(f.categoryId) ?? 0) + f.cents);
  return new Map([...totals].map(([id, cents]) => [id, window.length ? Math.round(cents / window.length) : 0]));
}

export function suggestBudget(c: HabitsContext): Suggestion | null {
  const complete = completeMonths(c.data);
  const income = avgIncome(complete);
  if (income <= 0) return null;
  const spend = avgSpend(complete);
  const goalSpendCents = Math.round(income * (1 - c.target / 100));
  const cutCents = Math.max(0, spend - goalSpendCents);

  const earning = incomeMonths(complete);
  const recent = lastN(earning, 12);
  const before = earning.slice(Math.max(0, earning.length - 24), Math.max(0, earning.length - 12));
  const now = flexAverages(c.data, recent);
  const then = before.length ? flexAverages(c.data, before) : null;
  const known = new Map(c.categories.map((x) => [x.id, x]));
  const rows = [...now]
    .filter(([id, cents]) => cents >= MIN_ROW_CENTS && known.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([categoryId, avgCents]) => {
      const grew = then ? avgCents - (then.get(categoryId) ?? 0) : 0;
      // Other holds charges still to sort, so it starts out too.
      const included = c.choices?.[categoryId] ?? (avgCents >= SMALL_CATEGORY_CENTS && !known.get(categoryId)?.isOther);
      return { categoryId, avgCents, exact: avgCents, grew, creptUp: grew > CREPT_UP_CENTS, included };
    });
  const inBudget = rows.filter((r) => r.included);

  let left = cutCents;
  if (c.style === 'soft') {
    for (const r of inBudget) {
      const take = Math.min(Math.max(0, r.grew), left);
      r.exact -= take;
      left -= take;
    }
  }
  const total = inBudget.reduce((s, r) => s + r.exact, 0);
  if (left > 0 && total > 0) {
    const share = left / total;
    for (const r of inBudget) {
      const floor = r.avgCents / 2;
      const take = Math.min(r.exact * share, Math.max(0, r.exact - floor));
      r.exact -= take;
      left -= take;
    }
  }
  const out = rows.map((r) => ({
    categoryId: r.categoryId,
    avgCents: r.avgCents,
    suggestedCents: r.included ? roundTo(r.exact) : r.avgCents,
    creptUp: r.creptUp,
    included: r.included,
  }));
  const saved = rows.reduce((s, r) => s + (r.avgCents - r.exact), 0);
  const reachablePct = left > ROUND_TO ? pct(income - (spend - saved), income) : null;
  return { goalSpendCents, cutCents, rows: out, reachablePct };
}

// ---------- other figures ----------

/** Needs, wants and saved as shares of income over all complete months. */
export function splitShares(d: HabitsData): Split | null {
  const ms = incomeMonths(completeMonths(d));
  const income = sum(ms, (m) => m.incomeCents);
  if (income <= 0) return null;
  const needs = sum(ms, (m) => m.essentialCents);
  const spend = sum(ms, (m) => m.spendCents);
  return { needs: pct(needs, income), wants: pct(spend - needs, income), saved: pct(income - spend, income) };
}

/** 3 to 6 months of essentials (the last 6 complete months' average), to the nearest $100; needs 3 complete months. */
export function emergencyRange(d: HabitsData): { monthlyCents: number; lowCents: number; highCents: number } | null {
  const ms = completeMonths(d);
  if (ms.length < 3) return null;
  const monthlyCents = Math.round(avg(lastN(ms, 6), (m) => m.essentialCents));
  const to100 = (c: number) => Math.round(c / 10000) * 10000;
  return { monthlyCents, lowCents: to100(monthlyCents * 3), highCents: to100(monthlyCents * 6) };
}

/** What's left for wants this month after needs and saving 20%. */
export function guiltFree(d: HabitsData): number {
  const ms = completeMonths(d);
  const cur = d.months.find((m) => m.month === d.currentMonth);
  const income = cur && cur.incomeCents > 0 ? cur.incomeCents : avgIncome(ms);
  const needs = Math.max(cur?.essentialCents ?? 0, Math.round(avg(lastN(ms, 12), (m) => m.essentialCents)));
  const wantsSoFar = cur ? Math.max(0, cur.spendCents - cur.essentialCents) : 0;
  return Math.max(0, Math.round(income - needs - income * 0.2 - wantsSoFar));
}

// ---------- tips ----------

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(localeFor(currency), { style: 'currency', currency, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.abs(cents) / 100);
}
const growth = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : 0);
const PER_YEAR: Record<Recurring['cadence'], number> = { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, yearly: 1 };
const RANK: Record<Tone, number> = { warn: 0, info: 1, good: 2 };

export function buildTips(c: HabitsContext): Tip[] {
  const d = c.data;
  if (!d.firstMonth) return [];
  const $ = (cents: number) => money(cents, c.currency);
  const complete = completeMonths(d);
  const tips: Tip[] = [];

  // Savings rate trend (FIRE): the last 12 complete months against the 12 before.
  const earning = incomeMonths(complete);
  if (c.style === 'fire' && earning.length >= 24) {
    const now = savingsRate(earning);
    const before = savingsRate(earning.slice(0, earning.length - 12));
    if (now != null && before != null) {
      const up = now >= before;
      tips.push({
        id: 'rate-trend',
        tone: up ? 'good' : 'warn',
        title: `Your savings rate is ${up ? 'up' : 'down'}`,
        detail: `${now}% saved over the last 12 months, ${up ? 'up' : 'down'} from ${before}% the year before. Every extra 10% saved takes roughly 5 to 10 years off the road to independence.`,
        value: now,
      });
    }
  }

  const split = splitShares(d);
  if (split) {
    const heavy = split.needs > 60;
    const thin = split.saved < 10;
    const close = split.needs <= 55 && split.wants <= 35 && split.saved >= 15;
    tips.push({
      id: 'split',
      tone: heavy || thin ? 'warn' : close ? 'good' : 'info',
      title: heavy ? 'Needs take most of your income' : thin ? 'Saving less than 10%' : close ? 'Close to 50/30/20' : 'Your 50/30/20 split',
      detail: 'Needs, wants and saving in the months your income shows up, against the classic split.',
      value: split.saved,
      split,
    });
  }

  const fund = emergencyRange(d);
  if (fund && fund.monthlyCents > 0) {
    tips.push({
      id: 'emergency',
      tone: 'info',
      title: `Emergency fund target: ${$(fund.lowCents)} to ${$(fund.highCents)}`,
      detail: `That's 3 to 6 months of your essentials (${$(fund.monthlyCents)} a month). Keep it in savings, apart from everyday money.`,
      value: fund.monthlyCents,
    });
  }

  // Lifestyle creep: the last 6 complete months against the 6 before.
  if (earning.length >= 12) {
    const recent = lastN(earning, 6);
    const before = earning.slice(earning.length - 12, earning.length - 6);
    const spendUp = growth(sum(recent, (m) => m.spendCents), sum(before, (m) => m.spendCents));
    const incomeUp = growth(sum(recent, (m) => m.incomeCents), sum(before, (m) => m.incomeCents));
    if (spendUp - incomeUp >= 5) {
      const now = flexAverages(d, recent);
      const then = flexAverages(d, before);
      const names = new Map(c.categories.map((x) => [x.id, x.name]));
      const grew = [...now]
        .map(([id, cents]) => ({ id, by: cents - (then.get(id) ?? 0), pct: growth(cents, then.get(id) ?? 0) }))
        .filter((g) => g.by > 0 && names.has(g.id))
        .sort((a, b) => b.by - a.by)
        .slice(0, 2)
        .map((g) => `${names.get(g.id)} (${g.pct > 0 ? `+${g.pct}%` : 'new'})`);
      const income = incomeUp >= 0 ? `income is up ${incomeUp}%` : `income is down ${-incomeUp}%`;
      tips.push({
        id: 'creep',
        tone: 'warn',
        title: 'Spending grew faster than income',
        detail: `Spending is up ${spendUp}% on the 6 months before, while ${income}.${grew.length ? ` Most of it is ${grew.join(' and ')}.` : ''}`,
        link: 'categories',
        value: spendUp,
      });
    }
  }

  // Subscriptions: recurring charges outside the needs (rent, phone and insurance bills aren't subscriptions).
  const needIds = new Set(c.categories.filter((x) => x.essential).map((x) => x.id));
  const subs = c.recurring.filter((r) => r.categoryId == null || !needIds.has(r.categoryId));
  if (subs.length) {
    const yearly = subs.reduce((s, r) => s + Math.abs(r.typicalAmountCents) * PER_YEAR[r.cadence], 0);
    const n = subs.length;
    const raised = d.billsRaisedLast12;
    tips.push({
      id: 'subs',
      tone: 'info',
      title: `Subscriptions cost ${$(yearly)} a year`,
      detail: `${n} recurring ${n === 1 ? 'charge' : 'charges'}, about ${$(Math.round(yearly / 12))} a month.${raised ? ` ${raised} went up in price in the last year.` : ''}`,
      link: 'recurring',
      value: yearly,
    });
  }

  const top = d.merchants.find((m) => m.visits > 0 && m.totalCents / m.visits < 1500 && m.totalCents >= 20000);
  if (top) {
    const each = Math.round(top.totalCents / top.visits);
    tips.push({
      id: 'repeat',
      tone: 'info',
      title: `${cleanMerchant(top.name)} adds up to ${$(top.totalCents)} a year`,
      detail: `${top.visits} visits, about ${$(each)} each. ${c.style === 'fire' ? `Halving it would keep about ${$(Math.round(top.totalCents / 2))} a year.` : "If it's a daily joy, keep it."}`,
      value: top.totalCents,
    });
  }

  if (c.today.slice(0, 7) === d.currentMonth) {
    const days = Number(c.today.slice(8, 10));
    const spent = d.daysThisMonth.filter((x) => x.cents > 0).length;
    const free = Math.max(0, days - spent);
    tips.push({
      id: 'nospend',
      tone: free >= days / 3 ? 'good' : 'info',
      title: `${free} no-spend ${free === 1 ? 'day' : 'days'} this month`,
      detail: `Days with nothing spent except bills, out of ${days} so far.`,
      value: free,
    });
  }

  if (c.hasSavings) {
    const cur = d.months.find((m) => m.month === d.currentMonth);
    const moved = cur?.toSavingsCents ?? 0;
    const income = cur && cur.incomeCents > 0 ? cur.incomeCents : avgIncome(complete);
    const share = income > 0 ? pct(moved, income) : 0;
    const aim = c.style === 'fire' ? c.target : 10;
    const ok = share >= aim;
    tips.push({
      id: 'payfirst',
      tone: ok ? 'good' : 'warn',
      title: `${$(moved)} moved to savings this month`,
      detail: `That's ${share}% of this month's income.${c.style === 'fire' && !ok ? ` Moving it on payday, before spending, makes ${c.target}% easier to reach.` : ''}`,
      value: moved,
    });
  }

  return tips.map((t, i) => ({ t, i })).sort((a, b) => RANK[a.t.tone] - RANK[b.t.tone] || a.i - b.i).map(({ t }) => t);
}

// ---------- hiding ----------

/** Whether a hidden tip's number has moved enough to show it again: more than 10%, or 3 points for percentages. */
function changedEnough(t: Tip, h: HiddenTip): boolean {
  if (PERCENT_TIPS.has(t.id)) return Math.abs(t.value - h.value) >= 3;
  if (h.value === 0) return t.value !== 0;
  return Math.abs(t.value - h.value) / Math.abs(h.value) > 0.1;
}

export function visibleTips(tips: Tip[], hidden: HiddenTip[]): { shown: Tip[]; hidden: Tip[] } {
  const byId = new Map(hidden.map((h) => [h.id, h]));
  const shown: Tip[] = [];
  const away: Tip[] = [];
  for (const t of tips) {
    const h = byId.get(t.id);
    if (h && !changedEnough(t, h)) away.push(t);
    else shown.push(t);
  }
  return { shown, hidden: away };
}
