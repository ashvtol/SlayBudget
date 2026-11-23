import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatMoney } from '@/lib/format';
import { useCurrencyStore } from '@/features/currency/currency-store';
import { Money } from './money';

afterEach(() => {
  cleanup();
  useCurrencyStore.setState({ displayCurrency: 'USD' });
});

describe('amounts in the display currency', () => {
  it('Money shows the display currency unless told otherwise', () => {
    useCurrencyStore.setState({ displayCurrency: 'INR' });
    render(<Money cents={123456789} />);
    expect(screen.getByText('₹')).toBeInTheDocument();
    expect(screen.getByText('12,34,567.89')).toBeInTheDocument();
  });

  it('rupees group in lakhs and crores; other currencies as usual', () => {
    expect(formatMoney(123456789, 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(123456789, 'USD')).toBe('$1,234,567.89');
    expect(formatMoney(123456, 'EUR')).toBe('€1,234.56');
  });
});
