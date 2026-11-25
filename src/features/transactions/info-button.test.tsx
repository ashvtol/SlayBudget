import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InfoButton } from './statement-box';

afterEach(() => cleanup());

describe('InfoButton', () => {
  it('draws the macOS info symbol: an outlined circle when closed, filled when open', () => {
    const { rerender } = render(<InfoButton label="Details" open={false} onToggle={() => {}} />);
    const button = screen.getByRole('button', { name: 'Details' });
    expect(button).toHaveTextContent('');
    const circle = button.querySelector('svg circle')!;
    expect(circle.getAttribute('fill')).toBe('none');
    expect(button.querySelector('svg [data-glyph="i"]')).not.toBeNull();
    rerender(<InfoButton label="Details" open onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Details' }).querySelector('svg circle')!.getAttribute('fill')).toBe('currentColor');
  });
});

describe('InfoButton state', () => {
  it('tells assistive tech whether its details are open, and toggles on click', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    let open = false;
    const { rerender } = render(<InfoButton label="Details" open={open} onToggle={() => (open = !open)} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
    await user.click(screen.getByRole('button', { name: 'Details' }));
    rerender(<InfoButton label="Details" open={open} onToggle={() => (open = !open)} />);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  });
});
