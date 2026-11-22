import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Money, moneyParts } from './money';
import { DeltaBadge, percentChange } from './delta-badge';
import { CategoryPill } from './category-pill';
import { Card } from './card';
import { Segmented } from './segmented';
import type { Category } from '@/lib/types';

describe('moneyParts', () => {
  it('splits symbol from the number and drops the sign', () => {
    expect(moneyParts(-262545, 'USD')).toEqual({ symbol: '$', number: '2,625.45' });
    expect(moneyParts(461500, 'USD', { decimals: false })).toEqual({ symbol: '$', number: '4,615' });
  });
});

describe('Money', () => {
  it('renders the raised symbol and the digits', () => {
    const { container } = render(<Money cents={2645} />);
    expect(container.textContent).toBe('$26.45');
    expect(container.querySelector('.money-symbol')?.textContent).toBe('$');
  });
  it('adds signs on request', () => {
    const { container, rerender } = render(<Money cents={-500} sign="negative" />);
    expect(container.textContent).toBe('-$5.00');
    rerender(<Money cents={500} sign="always" />);
    expect(container.textContent).toBe('+$5.00');
  });
  it('colors money in green in auto tone', () => {
    const { container } = render(<Money cents={4200} tone="auto" />);
    expect((container.firstChild as HTMLElement).style.color).toBe('var(--pos)');
  });
});

describe('percentChange and DeltaBadge', () => {
  it('computes change against the previous value', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, -100)).toBe(150);
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });
  it('labels direction and caps at 999%', () => {
    render(<DeltaBadge pct={1234.5} />);
    expect(screen.getByLabelText('Up 999.00%')).toBeInTheDocument();
  });
  it('treats spending going up as bad', () => {
    render(<DeltaBadge pct={12} upIsGood={false} />);
    expect(screen.getByLabelText('Up 12.00%').style.color).toBe('var(--neg)');
  });
});

describe('CategoryPill', () => {
  const cat: Category = { id: 1, groupId: 1, name: 'Restaurants', emoji: '🍔', color: '#e8743b', budgetCents: null, excluded: false, kind: 'expense', sortOrder: 0, archived: false };
  it('shows the name and emoji, tinted by the category color', () => {
    render(<CategoryPill category={cat} />);
    const pill = screen.getByRole('button', { name: /Restaurants/ });
    expect(pill.style.background).toContain('rgb(232, 116, 59)');
  });
  it('falls back to the given color and to "Needs category"', () => {
    const { rerender } = render(<CategoryPill category={{ ...cat, color: null }} fallbackColor="#123456" />);
    expect(screen.getByRole('button', { name: /Restaurants/ }).style.background).toContain('rgb(18, 52, 86)');
    rerender(<CategoryPill category={undefined} />);
    expect(screen.getByRole('button', { name: 'Needs category' })).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('renders title and fires the link', async () => {
    const onLink = vi.fn();
    render(<Card title="Top categories" linkLabel="View all" onLink={onLink}>body</Card>);
    expect(screen.getByRole('region', { name: 'Top categories' })).toHaveTextContent('body');
    await userEvent.click(screen.getByRole('button', { name: /View all/ }));
    expect(onLink).toHaveBeenCalled();
  });
});

describe('Segmented', () => {
  it('marks the active option and reports changes', async () => {
    const onChange = vi.fn();
    render(<Segmented aria-label="Range" options={[{ id: 'a', label: '1W' }, { id: 'b', label: '1M' }]} value="a" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: '1W' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: '1M' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('ToolbarButton labels', () => {
  it('never wrap onto two lines', async () => {
    const { ToolbarButton } = await import('./toolbar-button');
    render(<ToolbarButton>Mark reviewed</ToolbarButton>);
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toHaveClass('whitespace-nowrap', 'shrink-0');
  });
});
