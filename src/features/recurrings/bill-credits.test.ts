import { describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/types';
import { creditsFrom, pairAcrossBills, pairCredits, suggestPayback } from './bill-credits';

let nextId = 1;
const tx = (merchant: string, postedOn: string, amountCents: number, description = merchant.toUpperCase()): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description, merchant, amountCents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const charge = (postedOn: string, cents = 1428) => tx('walmart+ member', postedOn, -cents);
const credit = (postedOn: string, cents = 1428, merchant = 'platinum walmart+') => tx(merchant, postedOn, cents);

describe('creditsFrom', () => {
  it('finds money in by merchant key or a name in the description, never charges', () => {
    const a = credit('2026-10-22');
    const b = tx('amex credit', '2026-10-23', 1428, 'AMEX PLATINUM WALMART+ CREDIT');
    const out = tx('platinum walmart+', '2026-10-24', -1428);
    expect(creditsFrom([a, b, out, charge('2026-10-22')], ['Platinum Walmart+']).map((t) => t.id)).toEqual([a.id, b.id]);
    expect(creditsFrom([a], [])).toEqual([]);
  });
});

describe('pairCredits', () => {
  it('pairs each credit with the nearest charge within 10 days, one to one, even on another day', () => {
    const [c1, c2, c3] = [charge('2026-08-22'), charge('2026-09-22'), charge('2026-10-22')];
    const [k1, k2, far] = [credit('2026-08-25'), credit('2026-09-21'), credit('2026-11-15')];
    const pairs = pairCredits([c1, c2, c3], [k1, k2, far]);
    expect(pairs.get(c1.id)?.id).toBe(k1.id);
    expect(pairs.get(c2.id)?.id).toBe(k2.id);
    expect(pairs.has(c3.id)).toBe(false);
  });

  it('never pairs a credit bigger than the charge', () => {
    const c = charge('2026-10-22', 1000);
    expect(pairCredits([c], [credit('2026-10-22', 1500)]).size).toBe(0);
    expect(pairCredits([c], [credit('2026-10-22', 500)]).get(c.id)?.amountCents).toBe(500);
  });
});

describe('suggestPayback', () => {
  const charges = ['2026-07-22', '2026-08-22', '2026-09-22'].map((d) => charge(d));

  it('suggests a name whose credits match the charges', () => {
    const txs = [...charges, ...['2026-07-22', '2026-08-23', '2026-09-22'].map((d) => credit(d)), credit('2026-10-01', 9999, 'venmo')];
    expect(suggestPayback(charges, txs)).toMatchObject({ name: 'platinum walmart+', matched: 3 });
  });

  it('needs two matches (the same amount, or less on about the same day) and most of that name\'s credits', () => {
    expect(suggestPayback(charges, [...charges, credit('2026-07-22')])).toBeNull();
    expect(suggestPayback(charges, [...charges, credit('2026-07-27', 700), credit('2026-08-27', 700)])).toBeNull();
    const refunds = [credit('2026-07-22', 1428, 'amazon'), credit('2026-08-22', 1428, 'amazon'), ...['01', '02', '03', '04'].map((m) => credit(`2026-${m}-10`, 2500, 'amazon'))];
    expect(suggestPayback(charges, [...charges, ...refunds])).toBeNull();
  });
});

describe('suggestPayback for shared and partial credits', () => {
  it('suggests a credit shared with other bills when three or more charges match it exactly', () => {
    const peacock = ['2026-07-09', '2026-08-09', '2026-09-09'].map((d) => tx('peacock', d, -1657));
    const pool = [
      ...['2026-07-09', '2026-08-09', '2026-09-09'].map((d) => credit(d, 1657, 'platinum digital')),
      ...['2026-07-13', '2026-08-13', '2026-09-13', '2026-10-13', '2026-11-13'].map((d) => credit(d, 899, 'platinum digital')),
    ];
    expect(suggestPayback(peacock, [...peacock, ...pool])).toMatchObject({ name: 'platinum digital', matched: 3 });
  });

  it('does not take an unrelated partial credit near the charges for a payback', () => {
    const geico = ['2025-09-16', '2026-01-16'].map((d) => tx('geico auto', d, -32792));
    const saks = ['2025-09-16', '2026-01-14'].map((d) => credit(d, 5000, 'platinum saks'));
    expect(suggestPayback(geico, [...geico, ...saks])).toBeNull();
  });

  it('suggests a partial credit that lands with each purchase', () => {
    const lulu = [tx('lululemon athletica', '2025-12-27', -9821), tx('lululemon athletica', '2026-03-23', -8517)];
    const credits = ['2025-12-27', '2026-03-23'].map((d) => credit(d, 7500, 'platinum lululemon'));
    expect(suggestPayback(lulu, [...lulu, ...credits])).toMatchObject({ name: 'platinum lululemon', matched: 2 });
  });
});

describe('pairAcrossBills', () => {
  it('gives each shared credit to one bill: the nearest charge, then the closest amount', () => {
    const youtube = { id: 1, names: ['platinum digital'], charges: [tx('youtube', '2026-09-13', -899)] };
    const peacock = { id: 2, names: ['platinum digital'], charges: [tx('peacock', '2026-09-09', -1657)] };
    const k = credit('2026-09-13', 899, 'platinum digital');
    const pairs = pairAcrossBills([youtube, peacock], [k]);
    expect(pairs.get(youtube.charges[0].id)?.id).toBe(k.id);
    expect(pairs.has(peacock.charges[0].id)).toBe(false);
  });

  it('splits two same-day credits between two bills by amount', () => {
    const youtube = { id: 1, names: ['platinum digital'], charges: [tx('youtube', '2026-03-08', -1399)] };
    const peacock = { id: 2, names: ['platinum digital'], charges: [tx('peacock', '2026-03-08', -1657)] };
    const [a, b] = [credit('2026-03-08', 1399, 'platinum digital'), credit('2026-03-08', 1101, 'platinum digital')];
    const pairs = pairAcrossBills([youtube, peacock], [a, b]);
    expect(pairs.get(youtube.charges[0].id)?.id).toBe(a.id);
    expect(pairs.get(peacock.charges[0].id)?.id).toBe(b.id);
  });
});

describe('bill credits edge cases', () => {
  it('ignores a credit more than 10 days from any charge', () => {
    const c = charge('2026-10-22');
    expect(pairCredits([c], [credit('2026-11-05')]).size).toBe(0);
  });

  it('gives a credit only to the bill whose names it carries', () => {
    const walmart = { id: 1, names: ['platinum walmart+'], charges: [charge('2026-10-22')] };
    const other = { id: 2, names: ['platinum digital'], charges: [tx('peacock', '2026-10-22', -1428)] };
    const k = credit('2026-10-22');
    const pairs = pairAcrossBills([walmart, other], [k]);
    expect(pairs.get(walmart.charges[0].id)?.id).toBe(k.id);
    expect(pairs.has(other.charges[0].id)).toBe(false);
  });

  it('never suggests income or transfers as paybacks', () => {
    const charges = ['2026-07-22', '2026-08-22', '2026-09-22'].map((d) => charge(d));
    const pay = ['2026-07-22', '2026-08-22', '2026-09-22'].map((d) => ({ ...credit(d, 1428, 'payroll'), txType: 'income' as const }));
    const moved = ['2026-07-22', '2026-08-22', '2026-09-22'].map((d) => ({ ...credit(d, 1428, 'savings'), txType: 'transfer' as const }));
    expect(suggestPayback(charges, [...charges, ...pay, ...moved])).toBeNull();
  });

  it('lists the matched pairs newest first, marking each full or partial by amount', () => {
    const charges = [charge('2026-08-22'), charge('2026-09-22')];
    const hit = suggestPayback(charges, [...charges, credit('2026-08-22'), credit('2026-09-23')])!;
    expect(hit.pairs.map((p) => p.charge.postedOn)).toEqual(['2026-09-22', '2026-08-22']);
  });
});
