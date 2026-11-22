import { render, screen } from '@testing-library/react';
import { CategoryIcon } from './category-icon';

describe('CategoryIcon', () => {
  it('shows the emoji', () => {
    render(<CategoryIcon emoji="🛒" color="#e8743b" />);
    expect(screen.getByText('🛒')).toBeInTheDocument();
  });

  it('shows a dot in the category color when there is no emoji', () => {
    const { container } = render(<CategoryIcon emoji={null} color="#e8743b" />);
    const dot = container.querySelector('[data-testid="category-dot"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toBe('rgb(232, 116, 59)');
  });

  it('treats a blank emoji as none', () => {
    const { container } = render(<CategoryIcon emoji="  " color="#4c85ee" />);
    expect(container.querySelector('[data-testid="category-dot"]')).not.toBeNull();
  });
});
