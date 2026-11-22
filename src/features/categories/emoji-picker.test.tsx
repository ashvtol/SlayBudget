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
    await user.click(screen.getByRole('button', { name: /emoji/i }));
    const panel = screen.getByRole('dialog', { name: 'Choose emoji' });
    expect(panel).toHaveClass('left-0');
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
