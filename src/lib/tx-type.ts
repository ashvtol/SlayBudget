import type { Transaction, TxType } from './types';

/** A row's type; rows from older data without one are Regular. */
export const txTypeOf = (t: Pick<Transaction, 'txType'>): TxType => t.txType ?? 'regular';
export const isRegular = (t: Pick<Transaction, 'txType'>) => txTypeOf(t) === 'regular';

/** Spending a row contributes: Regular rows only, so a refund (money in) reduces it. */
export const spendOf = (t: Pick<Transaction, 'txType' | 'amountCents'>) => (isRegular(t) ? -t.amountCents : 0);

/** Income a row contributes: Income rows only. Transfers count in neither. */
export const incomeOf = (t: Pick<Transaction, 'txType' | 'amountCents'>) => (txTypeOf(t) === 'income' ? t.amountCents : 0);
