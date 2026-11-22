import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Category, Source, Transaction } from '@/lib/types';
import { displayMerchant, TransactionRow } from './transaction-row';

const tx: Transaction = {
  id: 1, profileId: 1, sourceId: 1, postedOn: '2026-11-21', description: 'MARINARA PIZZA NEW YORK NY', merchant: 'MARINARA PIZZA',
  amountCents: -2645, currency: 'USD', categoryId: 10, categoryLocked: false, reviewed: false, notes: null, refundOf: null,
};
const category: Category = { id: 10, groupId: 1, name: 'Restaurants', emoji: '🍔', color: '#e8743b', budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false };
const source: Source = { id: 1, profileId: 1, name: 'Amex Gold', kind: 'csv', institution: 'American Express', currency: 'USD' };

function renderRow(over: Partial<Parameters<typeof TransactionRow>[0]> = {}) {
  const props = { tx, category, source, selected: false, active: false, onToggleSelect: vi.fn(), onOpen: vi.fn(), onPickCategory: vi.fn(), ...over };
  render(<TransactionRow {...props} />);
  return props;
}

describe('displayMerchant', () => {
  it('title-cases the merchant', () => {
    expect(displayMerchant({ ...tx, merchant: 'AMC THEATRES' })).toBe('Amc Theatres');
    expect(displayMerchant({ ...tx, merchant: 'whole foods' })).toBe('Whole Foods');
  });
  it('falls back to the description when there is no merchant', () => {
    expect(displayMerchant({ ...tx, merchant: '', description: 'SHELL OIL 58000012345' })).toBe('Shell');
  });
});

describe('TransactionRow', () => {
  it('shows the merchant with the source name beside it', () => {
    renderRow();
    expect(screen.getByText('Marinara Pizza')).toBeInTheDocument();
    expect(screen.getByText('Amex Gold')).toBeInTheDocument();
  });

  it('shows money out in the default color and money in green, both unsigned', () => {
    const { unmount } = render(<TransactionRow tx={tx} category={category} source={source} selected={false} active={false} onToggleSelect={vi.fn()} onOpen={vi.fn()} onPickCategory={vi.fn()} />);
    expect(screen.getByTestId('amount')).toHaveTextContent('$26.45');
    expect(screen.getByTestId('amount').style.color).toBe('var(--text)');
    unmount();
    renderRow({ tx: { ...tx, amountCents: 4200 } });
    expect(screen.getByTestId('amount')).toHaveTextContent('$42.00');
    expect(screen.getByTestId('amount').style.color).toBe('var(--pos)');
  });

  it('marks unreviewed rows only', () => {
    const { unmount } = render(<TransactionRow tx={tx} category={category} source={source} selected={false} active={false} onToggleSelect={vi.fn()} onOpen={vi.fn()} onPickCategory={vi.fn()} />);
    expect(screen.getByLabelText('Needs review')).toBeInTheDocument();
    unmount();
    renderRow({ tx: { ...tx, reviewed: true } });
    expect(screen.queryByLabelText('Needs review')).not.toBeInTheDocument();
  });

  it('opens on click, selects via the checkbox, and picks a category via the pill without opening', async () => {
    const p = renderRow();
    await userEvent.click(screen.getByText('Marinara Pizza'));
    expect(p.onOpen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('checkbox', { name: /Select Marinara Pizza/ }));
    expect(p.onToggleSelect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Restaurants/ }));
    expect(p.onPickCategory).toHaveBeenCalled();
    expect(p.onOpen).toHaveBeenCalledTimes(1);
  });

  it('flags the open row', () => {
    renderRow({ active: true });
    expect(screen.getByRole('row')).toHaveAttribute('aria-current', 'true');
  });

  it('can hide the selection checkbox (read-only lists)', () => {
    renderRow({ selectable: false });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('TransactionRow types', () => {
  it('marks income with a badge and a green amount', () => {
    renderRow({ tx: { ...tx, amountCents: 300000, txType: 'income' }, category: undefined });
    expect(screen.getByRole('img', { name: 'Income' })).toHaveTextContent('I');
  });

  it('shows transfers with a Transfer pill instead of a category and a T badge', () => {
    renderRow({ tx: { ...tx, categoryId: null, txType: 'transfer' }, category: undefined });
    expect(screen.getByRole('img', { name: 'Internal transfer' })).toHaveTextContent('T');
    expect(screen.getByText('Transfer')).toBeInTheDocument();
    expect(screen.queryByText(/Needs category/i)).not.toBeInTheDocument();
  });

  it('shows no badge on regular rows', () => {
    renderRow();
    expect(screen.queryByRole('img', { name: /Income|Internal transfer/ })).not.toBeInTheDocument();
  });
});

describe('TransactionRow transfer amount', () => {
  it('does not draw money moved between your accounts as income', () => {
    renderRow({ tx: { ...tx, amountCents: 316864, categoryId: null, txType: 'transfer' }, category: undefined });
    expect(screen.getByTestId('amount').style.color).toBe('var(--muted)');
    expect(screen.getByTestId('amount').querySelector('[style*="--pos"]')).toBeNull();
  });
});

describe('TransactionRow recurring', () => {
  it('marks a charge that belongs to a recurring bill', () => {
    renderRow({ tx: { ...tx, recurringId: 3 } });
    expect(screen.getByRole('img', { name: 'Recurring' })).toHaveTextContent('R');
  });
});

describe('TransactionRow with tags (layout)', () => {
  it('keeps the merchant whole: the account name and tags give way first', async () => {
    const { useTagsStore } = await import('@/lib/stores/tags-store');
    useTagsStore.setState({ byId: { 1: { id: 1, name: 'Vacation 2026', color: '#9a5cf0', count: 1 } }, tags: [] });
    renderRow({ tx: { ...tx, tagIds: [1] } });
    expect(screen.getByText('Marinara Pizza')).toHaveClass('shrink-0');
    expect(screen.getByText('Amex Gold')).toHaveClass('min-w-0');
    expect(screen.getByTestId('row-tags')).toHaveClass('min-w-0', 'overflow-hidden');
  });
});

describe('TransactionRow +/- signs (Settings > Accessibility)', () => {
  it('signs amounts when the setting is on', async () => {
    const { useDisplayStore } = await import('@/lib/stores/display-store');
    useDisplayStore.setState({ signs: true });
    renderRow();
    expect(screen.getByTestId('amount')).toHaveTextContent('-$26.45');
    useDisplayStore.setState({ signs: false });
  });

  it('shows + for money in when signed', async () => {
    const { useDisplayStore } = await import('@/lib/stores/display-store');
    useDisplayStore.setState({ signs: true });
    renderRow({ tx: { ...tx, amountCents: 4200 } });
    expect(screen.getByTestId('amount')).toHaveTextContent('+$42.00');
    useDisplayStore.setState({ signs: false });
  });
});

describe('TransactionRow with a date', () => {
  it('shows the short day before the merchant when asked (lists grouped by month)', () => {
    renderRow({ showDate: true });
    expect(screen.getByTestId('row-date')).toHaveTextContent('Nov 21');
  });
  it('has no date by default', () => {
    renderRow();
    expect(screen.queryByTestId('row-date')).toBeNull();
  });
});
