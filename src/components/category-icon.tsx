/** A category's emoji, or a small dot in its color when it has none, so lists stay aligned. */
export function CategoryIcon({ emoji, color, className = 'w-4 text-center' }: { emoji: string | null | undefined; color?: string | null; className?: string }) {
  if (emoji && emoji.trim()) {
    return (
      <span aria-hidden="true" className={className}>
        {emoji}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={`${className} inline-flex items-center justify-center`}>
      <span data-testid="category-dot" className="inline-block h-[8px] w-[8px] rounded-full" style={{ background: color ?? '#8e8e93' }} />
    </span>
  );
}
