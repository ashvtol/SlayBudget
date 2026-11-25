import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type { Category } from '@/lib/types';
import { CategoryPill } from './category-pill';

afterEach(() => cleanup());

const food: Category = { id: 1, groupId: 1, name: 'Restaurants', emoji: '🍜', color: '#e8743b', budgetCents: null, excluded: false, kind: 'expense', sortOrder: 1, archived: false };

describe('CategoryPill', () => {
  it('is a button only when it does something, so it can sit inside another button', () => {
    const { rerender } = render(<CategoryPill category={food} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
    rerender(<CategoryPill category={undefined} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Needs category')).toBeInTheDocument();
    rerender(<CategoryPill category={food} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Restaurants/ })).toBeInTheDocument();
  });
});
