// Bills that are paid back: a card's statement credit for a subscription (Amex Platinum's Walmart+ credit, say).
// The credits are found by name and paired with the bill's charges when shown, so nothing goes stale.

import { normalizeDescription } from '@/lib/recategorize';
import type { Transaction } from '@/lib/types';

/** A credit pays back a charge up to this many days before or after it. */
export const CREDIT_WINDOW_DAYS = 10;

const dayNumber = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));

/** Money in carrying one of these names: its merchant key is the name, or its description contains it. */
export function creditsFrom(transactions: Transaction[], names: string[]): Transaction[] {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (wanted.length === 0) return [];
  return transactions.filter((t) => {
    if (t.amountCents <= 0) return false;
    const merchant = t.merchant.trim().toLowerCase();
    const description = normalizeDescription(t.description);
    return wanted.some((n) => merchant === n || description.includes(normalizeDescription(n)));
  });
}

/** Each credit paired with its nearest charge (within 10 days, no bigger than the charge), one to one: charge id to
 *  credit. Ties go to the closest amount. */
export function pairCredits(charges: Transaction[], credits: Transaction[]): Map<number, Transaction> {
  return pairAcrossBills([{ id: 0, names: [], charges }], credits, () => true);
}

/** Pair credits with the charges of every bill they could pay back, together, so a credit shared by several bills (a
 *  card's monthly entertainment credit split between YouTube and Peacock, say) goes to one charge only: the nearest,
 *  then the closest amount. Each bill takes only credits carrying one of its names. Charge id to credit. */
export function pairAcrossBills(
  bills: { id: number; names: string[]; charges: Transaction[] }[],
  credits: Transaction[],
  carries: (credit: Transaction, names: string[]) => boolean = (credit, names) => creditsFrom([credit], names).length > 0,
): Map<number, Transaction> {
  const options: { days: number; gap: number; charge: Transaction; credit: Transaction }[] = [];
  for (const bill of bills) {
    const own = credits.filter((c) => carries(c, bill.names));
    for (const charge of bill.charges) {
      for (const credit of own) {
        const days = daysApart(charge.postedOn, credit.postedOn);
        const size = -charge.amountCents;
        if (days <= CREDIT_WINDOW_DAYS && credit.amountCents <= size) options.push({ days, gap: size - credit.amountCents, charge, credit });
      }
    }
  }
  options.sort((a, b) => a.days - b.days || a.gap - b.gap || a.charge.id - b.charge.id || a.credit.id - b.credit.id);
  const pairs = new Map<number, Transaction>();
  const used = new Set<number>();
  for (const { charge, credit } of options) {
    if (pairs.has(charge.id) || used.has(credit.id)) continue;
    pairs.set(charge.id, credit);
    used.add(credit.id);
  }
  return pairs;
}

/** Words a card's credit name shares with any bill ("Platinum", "Credit"), so they say nothing about which bill. */
const GENERIC = new Set(['platinum', 'gold', 'amex', 'american', 'express', 'card', 'credit', 'statement', 'offer', 'the', 'com', 'inc']);
const words = (name: string) => new Set(name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !GENERIC.has(w)));
/** "Platinum Lululemon" and "Lululemon Athletica" share a word; "Platinum Saks" and "Geico Auto" don't. */
const related = (a: string, b: string) => {
  const wb = words(b);
  return [...words(a)].some((w) => wb.has(w));
};

/** A name whose credits look like paybacks for these charges, or null. A credit matches a charge when it's the same
 *  amount within 10 days, or less but within 2 days when its name shares a word with the charge's (a partial credit
 *  with each purchase: Platinum Lululemon for Lululemon Athletica). It needs two matches and
 *  either most of that name's credits, or three exact ones (a credit shared with other bills). The best match wins. */
export interface PaybackSuggestion {
  name: string;
  matched: number;
  /** The charges and the credits that matched them, newest first: what the suggestion is based on. */
  pairs: { charge: Transaction; credit: Transaction }[];
}

export function suggestPayback(charges: Transaction[], transactions: Transaction[]): PaybackSuggestion | null {
  const byName = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (t.amountCents <= 0 || t.txType === 'transfer' || t.txType === 'income' || !t.merchant.trim()) continue;
    const key = t.merchant.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), t]);
  }
  let best: PaybackSuggestion | null = null;
  for (const [name, credits] of byName) {
    let exact = 0;
    const pairs: PaybackSuggestion['pairs'] = [];
    for (const [chargeId, credit] of pairCredits(charges, credits)) {
      const charge = charges.find((c) => c.id === chargeId)!;
      const size = -charge.amountCents;
      const same = Math.abs(size - credit.amountCents) <= Math.max(1, Math.round(size * 0.01));
      if (same) exact++;
      if (same || (daysApart(charge.postedOn, credit.postedOn) <= 2 && related(credit.merchant, charge.merchant))) pairs.push({ charge, credit });
    }
    const matched = pairs.length;
    pairs.sort((a, b) => b.charge.postedOn.localeCompare(a.charge.postedOn) || b.charge.id - a.charge.id);
    if (matched >= 2 && (matched >= credits.length * 0.75 || exact >= 3) && (!best || matched > best.matched)) best = { name, matched, pairs };
  }
  return best;
}
