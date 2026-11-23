import { Switch } from '@/components/switch';
import { useDisplayStore } from '@/lib/stores/display-store';

/** Settings > Accessibility (Copilot): signed amounts, rolling numbers. */
export function AccessibilityPane() {
  const { signs, setSigns, rolling, setRolling } = useDisplayStore();
  return (
    <div className="flex flex-col gap-3">
      <Switch label="+/- signs on amounts" checked={signs} onChange={(v) => void setSigns(v)} />
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        Show a minus for money out and a plus for money in on transactions, in addition to color.
      </p>
      <Switch label="Animate changing numbers" checked={rolling} onChange={(v) => void setRolling(v)} />
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        When an amount changes (switching currency, an import, an undo), its digits roll like a ticker. Always off when
        macOS is set to reduce motion.
      </p>
    </div>
  );
}
