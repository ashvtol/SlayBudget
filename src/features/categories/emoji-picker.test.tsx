import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker, firstEmoji } from './emoji-picker';

afterEach(() => cleanup());

describe('EmojiPicker paste field', () => {
  it('ignores letters and picks only an actual emoji', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EmojiPicker value={null} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Choose emoji/ }));
    await user.type(screen.getByRole('textbox', { name: 'Paste an emoji' }), 'ab');
    expect(onChange).not.toHaveBeenCalled();
    await user.clear(screen.getByRole('textbox', { name: 'Paste an emoji' }));
    await user.click(screen.getByRole('textbox', { name: 'Paste an emoji' }));
    await user.paste('🍕');
    expect(onChange).toHaveBeenCalledWith('🍕');
  });
});

describe('EmojiPicker placement', () => {
  it("opens from the icon's left edge into the panel, not centred over the list pane beside it", async () => {
    const user = userEvent.setup();
    render(<EmojiPicker value="🙂" onChange={() => {}} />);
    const button = screen.getByRole('button', { name: /emoji/i });
    button.getBoundingClientRect = () => ({ left: 40, right: 72, top: 100, bottom: 132, width: 32, height: 32, x: 40, y: 100, toJSON: () => ({}) }) as DOMRect;
    await user.click(button);
    const panel = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(panel.style.left).toBe('40px');
    expect(panel).not.toHaveClass('-translate-x-1/2');
  });
});

describe('firstEmoji', () => {
  it('keeps whole emoji, including skin tones, ZWJ sequences, flags and keycaps', () => {
    expect(firstEmoji('🧑🏽')).toBe('🧑🏽');
    expect(firstEmoji('👍🏻 nice')).toBe('👍🏻');
    expect(firstEmoji('💇‍♂️')).toBe('💇‍♂️');
    expect(firstEmoji('🇺🇸')).toBe('🇺🇸');
    expect(firstEmoji('1️⃣')).toBe('1️⃣');
  });

  it('takes symbols like ✄ and ✂ too, but not letters or digits', () => {
    expect(firstEmoji('✄')).toBe('✄');
    expect(firstEmoji('✂️')).toBe('✂️');
    expect(firstEmoji('ab ✂')).toBe('✂');
    expect(firstEmoji('abc')).toBeNull();
    expect(firstEmoji('42')).toBeNull();
    expect(firstEmoji('')).toBeNull();
  });
});

describe('EmojiPicker paste field Enter', () => {
  it('picks the emoji on Enter, and says so when the text has none', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EmojiPicker value={null} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Choose emoji/ }));
    const field = screen.getByRole('textbox', { name: 'Paste an emoji' });
    await user.type(field, 'hair{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Type or paste an emoji');
    await user.clear(field);
    await user.paste('✄');
    expect(onChange).toHaveBeenCalledWith('✄');
  });
});

describe('EmojiPicker placement', () => {
  it('opens above everything, so a pane that clips its content cannot cut it off', async () => {
    const user = userEvent.setup();
    render(
      <div data-testid="pane" style={{ overflow: 'hidden', width: 120 }}>
        <EmojiPicker value={null} onChange={() => {}} />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Choose emoji' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(screen.getByTestId('pane')).not.toContainElement(dialog);
    expect(dialog.style.position).toBe('fixed');
  });

  it('stays inside the window near its right edge', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
    render(<EmojiPicker value={null} onChange={() => {}} />);
    const button = screen.getByRole('button', { name: 'Choose emoji' });
    button.getBoundingClientRect = () => ({ left: 950, right: 990, top: 100, bottom: 140, width: 40, height: 40, x: 950, y: 100, toJSON: () => ({}) }) as DOMRect;
    await user.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(parseFloat(dialog.style.left) + 264).toBeLessThanOrEqual(1000 - 8);
    expect(dialog.style.top).toBe('148px');
  });
});
