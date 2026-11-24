// The Dashboard's Tips card: your style and savings rate against its target, and the two most useful tips (warnings
// first), linking to Your money habits on Insights.

import { Card } from '@/components/card';
import { useNavStore } from '@/lib/stores/nav-store';
import { buildTips, completeMonths, savingsRate, visibleTips } from './habits-model';
import { useHabitsStore } from './habits-store';
import { TipCard, useHabitsContext } from './money-habits';

export function DashboardTips() {
  const ctx = useHabitsContext();
  const hidden = useHabitsStore((s) => s.hidden);
  const go = useNavStore((s) => s.go);
  if (!ctx) return null;
  const rate = savingsRate(completeMonths(ctx.data));
  const top = visibleTips(buildTips(ctx), hidden).shown.slice(0, 2);
  if (rate == null && top.length === 0) return null;
  return (
    <Card title="Tips" linkLabel="Insights" onLink={() => go('insights')}>
      {rate != null && (
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            {ctx.style === 'fire' ? '🔥' : '🌿'} Savings rate
          </span>
          <span className="text-[15px] font-semibold">
            {rate}% <span className="text-[12px] font-normal" style={{ color: 'var(--muted)' }}>of {ctx.target}% goal</span>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {top.map((t) => (
          <TipCard key={t.id} tip={t} compact />
        ))}
      </div>
    </Card>
  );
}
