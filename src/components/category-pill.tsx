import type { Category } from '@/lib/types';

/**
 * Tinted background and brightened text for a category color, as in the
 * Copilot pills. Works for hex colors and CSS variables alike.
 */
export function pillColors(color: string): { background: string; color: string } {
  return {
    background: `color-mix(in srgb, ${color} 26%, transparent)`,
    color: `color-mix(in srgb, ${color} var(--pill-tint), var(--pill-ink))`,
  };
}

/** The coloured category tag used throughout. Shows "Needs category" when unset. */
export function CategoryPill({
  category,
  onClick,
  fallbackColor,
  size = 'sm',
}: {
  category: Category | undefined;
  onClick?: () => void;
  /** Color to use when the category has none of its own (usually its group's). */
  fallbackColor?: string;
  size?: 'sm' | 'md';
}) {
  // Fixed heights so a pill always sits inside a 24px row with even space around it.
  const pad = size === 'md' ? 'h-[22px] px-2.5 text-[11px]' : 'h-[18px] px-2 text-[10px]';
  const emojiSize = size === 'md' ? 'text-[11px]' : 'text-[9px]';
  if (!category) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center rounded-full border border-dashed font-semibold uppercase leading-none tracking-[0.02em] ${pad}`}
        style={{ borderColor: 'var(--subtle)', color: 'var(--muted)' }}
      >
        Needs category
      </button>
    );
  }
  const colors = pillColors(category.color ?? fallbackColor ?? 'var(--accent)');
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex max-w-full items-center gap-1 rounded-full font-semibold uppercase leading-none tracking-[0.02em] whitespace-nowrap ${pad}`}
      style={colors}
    >
      {category.emoji && <span aria-hidden="true" className={`normal-case leading-none ${emojiSize}`}>{category.emoji}</span>}
      <span className="truncate leading-none">{category.name}</span>
    </button>
  );
}
