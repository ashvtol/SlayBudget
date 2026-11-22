import { Page } from '@/app/shell/page';
import { deriveInsights } from './insights';
import { useAnalyticsStore } from './analytics-store';
import { useAnalyticsData } from './use-analytics-data';
import { RangeSelector } from './range-selector';
import { SpendingMap } from './spending-map';

const TONE_COLOR: Record<string, string> = { good: 'var(--pos)', warn: 'var(--warn)', info: 'var(--accent)' };

export function InsightsPage() {
  useAnalyticsData();
  const { monthly, categories, budgets, cashflow, recurring, categoryMeta } = useAnalyticsStore();
  const insights = deriveInsights({ monthly, categories, budgets, cashflow, recurring, categoryMeta });

  return (
    <Page title="Insights" actions={<RangeSelector />}>
      <SpendingMap />
      {insights.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing notable in this range yet. Import more statements for richer insights.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {insights.map((i) => (
            <div key={i.id} className="flex gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
              <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[i.tone] }} />
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{i.title}</span>
                <span className="text-sm" style={{ color: 'var(--muted)' }}>{i.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
