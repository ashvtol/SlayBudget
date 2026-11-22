import { Switch } from '@/components/switch';
import { useDisplayStore } from '@/lib/stores/display-store';

/** Settings > Accessibility (Copilot): signed amounts. */
export function AccessibilityPane() {
  const signs = useDisplayStore((s) => s.signs);
  const setSigns = useDisplayStore((s) => s.setSigns);
  return (
    <div className="flex flex-col gap-3">
      <Switch label="+/- signs on amounts" checked={signs} onChange={(v) => void setSigns(v)} />
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        Show a minus for money out and a plus for money in on transactions, in addition to color.
      </p>
    </div>
  );
}
