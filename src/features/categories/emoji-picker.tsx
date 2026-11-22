import { useState } from 'react';

const COMMON = [
  '🛒', '🍔', '🍕', '☕', '🍸', '🥑', '🏠', '🔑', '💡', '📱', '🛜', '🚗', '⛽', '🚕', '🚆', '✈️',
  '🛍️', '👕', '💄', '🧴', '💪', '💊', '🐶', '🧸', '🎁', '🎟️', '🎮', '📚', '💳', '💰', '🏦', '🧾',
  '🔧', '🌿', '⚽', '🎵', '🍿', '📦', '❤️', '⭐',
];

/**
 * The first emoji in some text, whole: a skin tone, a joined sequence (💇‍♂️), a flag or a keycap
 * stays one emoji. Symbols such as ✄ count too; letters and digits on their own do not.
 */
export function firstEmoji(text: string): string | null {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  for (const { segment } of segments) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\p{So}/u.test(segment)) return segment;
  }
  return null;
}

/** A large emoji button; click opens a grid of common emoji and a field to paste any emoji. */
export function EmojiPicker({ value, onChange, size = 32 }: { value: string | null; onChange: (emoji: string) => void; size?: number }) {
  const [open, setOpen] = useState(false);
  const [notEmoji, setNotEmoji] = useState(false);
  const pick = (e: string) => {
    onChange(e);
    setOpen(false);
    setNotEmoji(false);
  };
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-label={`Choose emoji${value ? ` (current ${value})` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="rounded-md leading-none hover:opacity-80"
        style={{ fontSize: size }}
      >
        {value || '🙂'}
      </button>
      {open && (
        <div role="dialog" aria-label="Choose emoji" className="absolute left-0 top-full z-50 mt-2 w-[264px] rounded-lg border p-2 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
          <div className="grid grid-cols-8 gap-1">
            {COMMON.map((e) => (
              <button key={e} type="button" aria-label={e} onClick={() => pick(e)} className="rounded p-1 text-[18px] leading-none hover:bg-[var(--hover)]">
                {e}
              </button>
            ))}
          </div>
          <input
            aria-label="Paste an emoji"
            placeholder="Or paste any emoji"
            onChange={(ev) => {
              // Pasting or picking from the Mac's emoji viewer sets it at once; letters wait for Enter.
              setNotEmoji(false);
              const emoji = firstEmoji(ev.target.value);
              if (emoji) pick(emoji);
            }}
            onKeyDown={(ev) => {
              if (ev.key !== 'Enter') return;
              const emoji = firstEmoji(ev.currentTarget.value);
              if (emoji) pick(emoji);
              else setNotEmoji(true);
            }}
            className="mt-2 h-[26px] w-full rounded-md border bg-transparent px-2 text-[12px] outline-none"
            style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
          />
          {notEmoji && (
            <p role="alert" className="m-0 mt-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
              Type or paste an emoji (Control-Command-Space opens the Mac's emoji viewer).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
