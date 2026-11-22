import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Ring, ringFraction, Sparkline, sparkPoints } from './mini-charts';

describe('ringFraction', () => {
  it('is value over total, clamped to 0..1', () => {
    expect(ringFraction(25, 100)).toBe(0.25);
    expect(ringFraction(150, 100)).toBe(1);
    expect(ringFraction(-5, 100)).toBe(0);
  });
  it('is 0 when there is no total', () => {
    expect(ringFraction(10, 0)).toBe(0);
  });
});

describe('Ring', () => {
  it('draws the filled arc proportional to value/total and labels itself', () => {
    const { container } = render(<Ring value={30} total={120} label="Spent vs budget" />);
    expect(screen.getByRole('img', { name: 'Spent vs budget' })).toBeInTheDocument();
    const arc = container.querySelector('[data-part="arc"]') as SVGCircleElement;
    const [filled, rest] = (arc.getAttribute('stroke-dasharray') ?? '').split(' ').map(Number);
    expect(filled / (filled + rest)).toBeCloseTo(0.25, 5);
  });
});

describe('sparkPoints', () => {
  it('spreads x across the width and maps min to bottom, max to top', () => {
    expect(sparkPoints([0, 5, 10], 100, 20)).toBe('0,20 50,10 100,0');
  });
  it('draws a flat series through the middle', () => {
    expect(sparkPoints([3, 3], 10, 20)).toBe('0,10 10,10');
  });
  it('handles a single value and an empty series', () => {
    expect(sparkPoints([7], 10, 20)).toBe('0,10 10,10');
    expect(sparkPoints([], 10, 20)).toBe('');
  });
});

describe('Sparkline', () => {
  it('is green when the series ends higher, red when lower', () => {
    const { container, rerender } = render(<Sparkline values={[1, 2, 3]} />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--pos)');
    rerender(<Sparkline values={[3, 2, 1]} />);
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--neg)');
  });
});
