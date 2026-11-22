import { describe, expect, it } from 'vitest';
import { parseQuery, runSearch } from './search';
import type { Transaction } from './types';

const TODAY = '2026-11-17';

function tx(over: Partial<Transaction> & Pick<Transaction, 'id' | 'postedOn' | 'amountCents' | 'description'>): Transaction {
  return { profileId: 1, sourceId: 1, merchant: over.description!.toLowerCase(), currency: 'USD', categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null, ...over };
}

describe('parseQuery', () => {
  it('extracts amounts, periods, sign and leftover text', () => {
    expect(parseQuery('starbucks over $5 last month', TODAY)).toMatchObject({ text: 'starbucks', minAbsCents: 500, from: '2026-10-01', to: '2026-10-31' });
    expect(parseQuery('groceries in january', TODAY)).toMatchObject({ text: 'groceries', from: '2026-01-01', to: '2026-01-31' });
    expect(parseQuery('income in 2025', TODAY)).toMatchObject({ incomeOnly: true, from: '2025-01-01', to: '2025-12-31' });
    expect(parseQuery('under $20 ytd', TODAY)).toMatchObject({ maxAbsCents: 2000, from: '2026-01-01', to: '2026-11-17', text: '' });
  });
});

describe('runSearch', () => {
  const rows = [
    tx({ id: 1, postedOn: '2026-10-04', amountCents: -650, description: 'STARBUCKS STORE 123' }),
    tx({ id: 2, postedOn: '2026-10-20', amountCents: -1200, description: 'STARBUCKS RESERVE' }),
    tx({ id: 3, postedOn: '2026-11-01', amountCents: -5000, description: 'WHOLE FOODS' }),
    tx({ id: 4, postedOn: '2026-11-02', amountCents: 500000, description: 'PAYROLL', txType: 'income' }),
  ];
  it('matches text prefixes and filters', () => {
    expect(runSearch(rows, parseQuery('starb', TODAY), 50).map((t) => t.id)).toEqual([2, 1]);
    expect(runSearch(rows, parseQuery('starbucks over $10', TODAY), 50).map((t) => t.id)).toEqual([2]);
    expect(runSearch(rows, parseQuery('in october', TODAY), 50)).toHaveLength(2);
    expect(runSearch(rows, parseQuery('income', TODAY), 50).map((t) => t.id)).toEqual([4]);
  });
});

describe('runSearch by type', () => {
  it('finds income and spending by transaction type, not by sign', () => {
    const rows = [
      tx({ id: 1, postedOn: '2026-11-01', amountCents: 500000, description: 'ACME PAYROLL', txType: 'income' }),
      tx({ id: 2, postedOn: '2026-11-02', amountCents: 120000, description: 'ONLINE PAYMENT THANK YOU', txType: 'transfer' }),
      tx({ id: 3, postedOn: '2026-11-03', amountCents: 2500, description: 'AMAZON REFUND', txType: 'regular' }),
      tx({ id: 4, postedOn: '2026-11-04', amountCents: -650, description: 'BLUE BOTTLE COFFEE', txType: 'regular' }),
      tx({ id: 5, postedOn: '2026-11-05', amountCents: -100000, description: 'TRANSFER TO SAVINGS', txType: 'transfer' }),
    ];
    expect(runSearch(rows, parseQuery('income', TODAY), 50).map((t) => t.id)).toEqual([1]);
    expect(runSearch(rows, parseQuery('spending', TODAY), 50).map((t) => t.id)).toEqual([4]);
  });
});

