// Notification producers for the in-memory IPC: a mirror of crates/core/src/notifications/producers.rs, kept in step
// by notification-producers.test.ts. The desktop app uses the Rust version.

import { budgetsForMonth } from './budget-plan';
import type { NotificationConfig } from './notification-config';
import type { BillPriceChange, BudgetPlan, Category, DuplicateFlag, NewNotification, PriceCheck, Recurring, Transaction } from './types';
import { isRegular, txTypeOf } from './tx-type';

const RECENT_DAYS = 7;
const PRICE_WINDOW_DAYS = 45;
/** After this long without a charge, a bill is "not seen lately" (likely cancelled), not missed. */
const MISSED_WINDOW_DAYS = 35;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ProducerInput {
  transactions: Transaction[];
  /** Saved bills as the Recurrings screen sees them (with `saved`). */
  recurring: Recurring[];
  categories: Category[];
  plan: BudgetPlan;
  config: NotificationConfig;
  today: string;
  /** Split parents are counted through their parts. */
  isSplitParent: (id: number) => boolean;
  /** Possible-duplicate flags and the file name of each import, for one item per import with open flags. */
  duplicateFlags?: DuplicateFlag[];
  importFileName?: (importId: number) => string | undefined;
  /** Charges that may be a bill at a new price (open), and each bill's latest price change. */
  priceChecks?: PriceCheck[];
  priceChanges?: BillPriceChange[];
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const c = Math.abs(cents);
  return `${sign}$${Math.trunc(c / 100).toLocaleString('en-US')}.${String(c % 100).padStart(2, '0')}`;
}
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(utc(d).getTime() + n * 86_400_000);
const daysBetween = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);
const day = (d: string) => {
  const x = utc(d);
  return `${DAYS[x.getUTCDay()]}, ${MONTHS[x.getUTCMonth()].slice(0, 3)} ${x.getUTCDate()}`;
};
const titleCase = (s: string) => s.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
const lastDayOf = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

/** One item per import that still has open possible-duplicate flags (mirrors `possible_duplicates`). */
function possibleDuplicates(input: ProducerInput): NewNotification[] {
  const byImport = new Map<number, DuplicateFlag[]>();
  for (const f of input.duplicateFlags ?? []) {
    if (f.resolution != null || f.importId == null || f.txId == null) continue;
    byImport.set(f.importId, [...(byImport.get(f.importId) ?? []), f]);
  }
  return [...byImport.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([importId, flags]) => {
      const file = input.importFileName?.(importId);
      if (file == null) return [];
      const profileId = input.transactions.find((t) => t.id === flags[0].txId)?.profileId ?? null;
      const what = flags.length === 1 ? '1 possible duplicate' : `${flags.length} possible duplicates`;
      return [{
        key: `duplicates:${importId}`,
        kind: 'possibleDuplicates' as const,
        title: `${what} from ${file}`,
        body: 'They look like transactions you already had, and are tagged Possible duplicate to review.',
        target: { kind: 'transactions' as const, filter: 'duplicates' as const },
        profileId,
      }];
    });
}

export function produceCandidates(input: ProducerInput): NewNotification[] {
  const { transactions, config, today } = input;
  const out: NewNotification[] = [];
  const regular = (t: Transaction) => isRegular(t) && !input.isSplitParent(t.id);
  const recentFrom = addDays(today, -RECENT_DAYS);
  const recent = (t: Transaction) => t.postedOn >= recentFrom && t.postedOn <= today;
  const chargesOf = (rid: number) =>
    transactions.filter((t) => t.recurringId === rid).sort((a, b) => b.postedOn.localeCompare(a.postedOn) || b.id - a.id);
  // Statements are imported by hand: a missing charge only means "missed" once the account's data runs past the due date.
  const statementCovers = (rid: number, due: string) => {
    const source = chargesOf(rid)[0]?.sourceId;
    return source != null && transactions.some((t) => t.sourceId === source && t.postedOn > due);
  };

  // Bills: upcoming N days before and on the due day; missed after the grace period.
  for (const view of input.recurring) {
    const s = view.saved;
    if (!s || s.status !== 'active') continue;
    const due = view.nextDate;
    const until = daysBetween(today, due);
    const profileId = chargesOf(s.id)[0]?.profileId ?? null;
    const target = { kind: 'recurring' as const, id: s.id };
    const about = `About ${money(view.typicalAmountCents)} on ${day(due)}`;
    if (until > 0 && until <= config.billLeadDays) {
      const when = until === 1 ? 'tomorrow' : `in ${until} days`;
      out.push({ key: `bill:${s.id}:${due}`, kind: 'billUpcoming', title: `${s.name} is due ${when}`, body: about, target, profileId });
    } else if (until === 0 && config.billDueDay) {
      out.push({ key: `billdue:${s.id}:${due}`, kind: 'billUpcoming', title: `${s.name} is due today`, body: about, target, profileId });
    } else if (until < 0 && -until >= config.missedGraceDays && -until <= MISSED_WINDOW_DAYS && statementCovers(s.id, due)) {
      out.push({
        key: `missed:${s.id}:${due}`,
        kind: 'billMissed',
        title: `${s.name} looks missed`,
        body: `Expected about ${money(view.typicalAmountCents)} on ${day(due)}, and no charge has come in yet.`,
        target,
        profileId,
      });
    }
  }

  // Price went up: the latest charge vs the one before.
  for (const view of input.recurring) {
    const s = view.saved;
    if (!s || s.status !== 'active') continue;
    const [last, prev, earlier] = chargesOf(s.id).filter((t) => t.amountCents < 0);
    if (!last || !prev || !earlier || last.postedOn < addDays(today, -PRICE_WINDOW_DAYS)) continue;
    const now = -last.amountCents;
    const before = -prev.amountCents;
    // A price went up only if it had been steady: the two charges before agree within 1%.
    if (Math.abs(before + earlier.amountCents) > Math.max(1, Math.trunc(-earlier.amountCents / 100))) continue;
    const rise = now - before;
    if (before <= 0 || rise < Math.max(1, config.priceUpMinCents) || rise * 100 < config.priceUpPercent * before) continue;
    out.push({
      key: `price:${s.id}:${last.postedOn}`,
      kind: 'priceUp',
      title: `${s.name} went up`,
      body: `From ${money(before)} to ${money(now)} (+${Math.round((rise * 100) / before)}%)`,
      target: { kind: 'recurring', id: s.id },
      profileId: last.profileId,
    });
  }

  // A charge that may be a bill at a new price, and a confirmed drop.
  const billsById = new Map(input.recurring.flatMap((v) => (v.saved ? [[v.saved.id, v.saved] as const] : [])));
  for (const c of input.priceChecks ?? []) {
    const bill = billsById.get(c.recurringId);
    const t = transactions.find((x) => x.id === c.txId);
    if (!bill || !t || t.postedOn < addDays(today, -PRICE_WINDOW_DAYS)) continue;
    out.push({
      key: `pricecheck:${c.id}`,
      kind: 'priceUp',
      title: `${bill.name} may have a new price`,
      body: `${money(c.newCents)} (was ${money(c.oldCents)})`,
      target: { kind: 'transaction', id: c.txId },
      profileId: t.profileId,
    });
  }
  for (const ch of input.priceChanges ?? []) {
    const bill = billsById.get(ch.recurringId);
    if (!bill || bill.status !== 'active' || ch.toCents >= ch.fromCents || ch.fromCents <= 0 || ch.changedOn < addDays(today, -PRICE_WINDOW_DAYS)) continue;
    out.push({
      key: `pricedown:${bill.id}:${ch.changedOn}`,
      kind: 'priceUp',
      title: `${bill.name} went down`,
      body: `From ${money(ch.fromCents)} to ${money(ch.toCents)} (${Math.round(((ch.toCents - ch.fromCents) * 100) / ch.fromCents)}%)`,
      target: { kind: 'recurring', id: bill.id },
      profileId: chargesOf(bill.id)[0]?.profileId ?? null,
    });
  }

  // Possible double charges.
  const dupCandidates = transactions.filter((t) => regular(t) && t.amountCents < 0 && t.recurringId == null);
  for (const t of dupCandidates) {
    if (!recent(t)) continue;
    for (const a of dupCandidates) {
      if (a.id >= t.id || a.merchant !== t.merchant || a.amountCents !== t.amountCents || a.profileId !== t.profileId) continue;
      if (Math.abs(daysBetween(a.postedOn, t.postedOn)) > config.doubleChargeDays) continue;
      const name = titleCase(t.merchant);
      out.push({
        key: `dup:${a.id}:${t.id}`,
        kind: 'doubleCharge',
        title: 'Possible double charge',
        body: `Two charges of ${money(-t.amountCents)} at ${name} around ${day(t.postedOn)}`,
        target: { kind: 'transactions', filter: 'search', text: name },
        profileId: t.profileId,
      });
    }
  }

  // Large transactions and money in (recent only).
  for (const t of transactions) {
    if (!recent(t) || input.isSplitParent(t.id)) continue;
    if (regular(t) && -t.amountCents >= config.largeCents) {
      out.push({
        key: `large:${t.id}`,
        kind: 'largeTransaction',
        title: 'Large transaction',
        body: `${money(-t.amountCents)} at ${titleCase(t.merchant)} on ${day(t.postedOn)}`,
        target: { kind: 'transaction', id: t.id },
        profileId: t.profileId,
      });
    }
    const refund = t.refundOf != null;
    if (t.amountCents > 0 && t.amountCents >= config.moneyInMinCents && (txTypeOf(t) === 'income' || refund)) {
      if (refund ? !config.moneyInRefunds : !config.moneyInPaychecks) continue;
      out.push({
        key: `in:${t.id}`,
        kind: 'moneyIn',
        title: refund ? 'Refund received' : 'Paycheck arrived',
        body: `${money(t.amountCents)} from ${titleCase(t.merchant)}`,
        target: { kind: 'transaction', id: t.id },
        profileId: t.profileId,
      });
    }
  }

  out.push(...possibleDuplicates(input));

  // Budgets, the monthly recap and the review digest.
  const excluded = new Set(input.categories.filter((c) => c.excluded).map((c) => c.id));
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const spendBy = (from: string, to: string) => {
    const m = new Map<number, number>();
    for (const t of transactions) {
      if (!regular(t) || t.categoryId == null || excluded.has(t.categoryId) || t.postedOn < from || t.postedOn > to) continue;
      m.set(t.categoryId, (m.get(t.categoryId) ?? 0) - t.amountCents);
    }
    return m;
  };
  const budgetsFor = (ym: string) =>
    budgetsForMonth(input.plan, input.categories, ym).categories.filter((c) => c.budgetCents != null && c.budgetCents > 0);

  const ym = today.slice(0, 7);
  const dom = Number(today.slice(8, 10));
  const spent = spendBy(`${ym}-01`, today);
  // Bills are paid once a month: count them as they are and project only everyday spending.
  const billed = new Map<number, number>();
  for (const t of transactions) {
    if (t.recurringId == null || !regular(t) || t.categoryId == null || t.postedOn < `${ym}-01` || t.postedOn > today) continue;
    billed.set(t.categoryId, (billed.get(t.categoryId) ?? 0) - t.amountCents);
  }
  for (const c of budgetsFor(ym)) {
    const budget = c.budgetCents as number;
    const s = spent.get(c.id) ?? 0;
    const target = { kind: 'category' as const, id: c.id, month: ym };
    const body = `${money(s)} of ${money(budget)} spent in ${monthName(ym)}`;
    if (s > budget) {
      out.push({ key: `over:${c.id}:${ym}`, kind: 'overBudget', title: `${c.name} is over budget`, body, target, profileId: null });
    } else if (config.budgetWarnPercent < 100 && s * 100 >= budget * config.budgetWarnPercent) {
      out.push({ key: `near:${c.id}:${ym}`, kind: 'overBudget', title: `${c.name} has used ${Math.trunc((s * 100) / budget)}% of its budget`, body, target, profileId: null });
    } else if (s < budget && config.budgetOnPace && dom >= 8) {
      const bills = Math.min(s, billed.get(c.id) ?? 0);
      const pace = bills + Math.trunc(((s - bills) * lastDayOf(ym)) / dom);
      if (pace > budget) {
        out.push({ key: `pace:${c.id}:${ym}`, kind: 'overBudget', title: `${c.name} is on pace to overspend`, body: `On pace for ${money(pace)} of ${money(budget)} in ${monthName(ym)}`, target, profileId: null });
      }
    }
  }

  if (dom <= 3) {
    const prevLast = addDays(`${ym}-01`, -1);
    const prev = prevLast.slice(0, 7);
    const byCat = spendBy(`${prev}-01`, prevLast);
    const total = [...byCat.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
      const budget = budgetsFor(prev).reduce((a, c) => a + (c.budgetCents as number), 0);
      let body: string;
      if (budget > 0) {
        const diff = budget - total;
        body = `Spent ${money(total)} of ${money(budget)} budgeted (${diff >= 0 ? `${money(diff)} under` : `${money(-diff)} over`}).`;
      } else body = `Spent ${money(total)}.`;
      const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && names.get(top[0])) body += ` Top category: ${names.get(top[0])}.`;
      out.push({ key: `recap:${prev}`, kind: 'monthlyRecap', title: `Your ${monthName(prev)} recap`, body, target: { kind: 'category', id: null, month: prev }, profileId: null });
    }
  }

  if (utc(today).getUTCDay() === config.digestWeekday) {
    const waiting = transactions.filter((t) => !t.reviewed).length;
    if (waiting >= config.digestMin) {
      out.push({
        key: `digest:${today}`,
        kind: 'reviewDigest',
        title: `${waiting} transactions to review`,
        body: 'A quick review keeps your categories and budgets accurate.',
        target: { kind: 'transactions', filter: 'review' },
        profileId: null,
      });
    }
  }
  return out;
}
