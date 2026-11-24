// "Your money habits" on Insights: your money style (FIRE or Soft saving) with its figures, a suggested budget toward
// a savings target, and tips, all from every month of history. The time range at the top of the page doesn't apply.

import { useEffect, useState } from 'react';
import { Card } from '@/components/card';
import { Money } from '@/components/money';
import { Button } from '@/components/button';
import { SegmentedControl } from '@/components/segmented-control';
import { IconClose, IconHelp } from '@/components/icons';
import { ipc } from '@/lib/ipc';
import { localeFor } from '@/lib/format';
import { useNavStore } from '@/lib/stores/nav-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import { displayCurrency } from '@/features/currency/currency-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import {
  buildTips,
  completeMonths,
  defaultTarget,
  fiAt35,
  fiNumber,
  guiltFree,
  MAX_TARGET,
  MIN_TARGET,
  monthlyRates,
  savingsRate,
  suggestBudget,
  visibleTips,
  yearlySpend,
  yearsToFi,
  avgIncome,
  avgSpend,
  type HabitsContext,
  type Split,
  type Style,
  type SuggestionRow,
  type Tip,
} from './habits-model';
import { useHabitsData, useHabitsStore } from './habits-store';
import { useUndoStore } from '@/features/undo/undo-store';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym: string) => `${SHORT_MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Suggested-budget rows shown before Show all. */
const SHOWN_ROWS = 10;
export const TONE_COLOR: Record<Tip['tone'], string> = { good: 'var(--pos)', warn: 'var(--warn)', info: 'var(--accent)' };

/** The context every figure is worked out from, or null while loading or without history. */
export function useHabitsContext(): HabitsContext | null {
  useHabitsData();
  const s = useHabitsStore();
  const today = useAnalyticsStore((x) => x.today);
  if (!s.data || !s.data.firstMonth) return null;
  const rate = savingsRate(completeMonths(s.data));
  return {
    style: s.style,
    target: s.targets[s.style] ?? defaultTarget(s.style, rate),
    data: s.data,
    categories: s.categories,
    recurring: s.recurring,
    hasSavings: s.hasSavings,
    today,
    currency: displayCurrency(),
    choices: s.choices,
    budgets: s.budgets,
  };
}

export function MoneyHabits() {
  const ctx = useHabitsContext();
  const loaded = useHabitsStore((s) => s.data != null);
  return (
    <section aria-label="Your money habits" className="mt-4 flex flex-col gap-6 border-t pt-8" style={{ borderColor: 'var(--line)' }}>
      <header>
        <h2 className="m-0 text-[18px] font-semibold">Your money habits</h2>
        {ctx && (
          <p className="m-0 mt-1 text-[12.5px]" style={{ color: 'var(--muted)' }}>
            Based on all your history, {monthLabel(ctx.data.firstMonth!)} to {monthLabel(ctx.data.currentMonth)}. The time range at the top doesn't change this section.
          </p>
        )}
      </header>
      {!ctx ? (
        loaded && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>Import a few months of statements to see your money habits.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 items-start gap-6">
            <StyleCard ctx={ctx} />
            <SuggestedBudget ctx={ctx} />
          </div>
          <TipsList ctx={ctx} />
        </>
      )}
    </section>
  );
}

// ---------- Your money style ----------

function StyleCard({ ctx }: { ctx: HabitsContext }) {
  const setStyle = useHabitsStore((s) => s.setStyle);
  const [info, setInfo] = useState(false);
  const complete = completeMonths(ctx.data);
  const rate = savingsRate(complete);
  const yearly = yearlySpend(complete);
  const income = avgIncome(complete);
  const years = rate == null ? null : yearsToFi(rate);
  return (
    <Card
      title="Your money style"
      actions={
        <button type="button" aria-label="About the two styles" onClick={() => setInfo(!info)} className="hover:opacity-80" style={{ color: 'var(--muted)' }}>
          <IconHelp size={15} />
        </button>
      }
    >
      <div className="relative flex flex-col gap-4">
        <SegmentedControl
          aria-label="Money style"
          fill
          options={[
            { id: 'fire', label: 'FIRE' },
            { id: 'soft', label: 'Soft saving' },
          ]}
          value={ctx.style}
          onChange={(s: Style) => void setStyle(s)}
        />
        {info && <StylesInfo onClose={() => setInfo(false)} />}
        {rate == null ? (
          <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>Needs 3 months of income to work this out.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="label-caps" style={{ color: 'var(--muted)' }}>Savings rate</div>
                <div className="text-[28px] font-semibold leading-tight">{rate}%</div>
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                  {income >= avgSpend(complete) ? (
                    <>
                      <Money cents={income - avgSpend(complete)} decimals={false} tone="muted" /> of <Money cents={income} decimals={false} tone="muted" /> a month, last 12 months
                    </>
                  ) : (
                    <>
                      <Money cents={avgSpend(complete) - income} decimals={false} tone="neg" /> more spent than came in, a month, last 12 months
                    </>
                  )}
                </div>
              </div>
              <RateBars rates={monthlyRates(complete)} goal={ctx.target} />
            </div>
            {ctx.style === 'fire' ? (
              <div className="grid grid-cols-2 gap-3">
                <Stat
                  label="Your FI number"
                  value={<Money cents={fiNumber(yearly)} decimals={false} />}
                  note={
                    <>
                      25 × <Money cents={yearly} decimals={false} tone="muted" /> a year · at 3.5%: <Money cents={fiAt35(yearly)} decimals={false} tone="muted" />
                    </>
                  }
                />
                <Stat label="Years to FI at this rate" value={years == null ? 'Not reachable at this rate' : `about ${Math.round(years)}`} note="from zero, 5% real growth (illustration)" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Saving for later" value={rate >= 20 ? '✓ over 20%' : `${rate}% (aim for 20%)`} note="the 20 in 50/30/20" />
                <Stat label="Guilt-free this month" value={<Money cents={guiltFree(ctx.data)} decimals={false} />} note="left for wants after needs and saving" />
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function StylesInfo({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div role="dialog" aria-label="About the two styles" className="absolute left-0 right-0 top-10 z-30 flex flex-col gap-3 rounded-lg border p-4 text-[12.5px] shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Two ways to save</span>
        <button type="button" aria-label="Close" onClick={onClose} style={{ color: 'var(--muted)' }}>
          <IconClose size={14} />
        </button>
      </div>
      <div>
        <div className="font-semibold">🔥 FIRE: Financial Independence, Retire Early</div>
        <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>
          Save a big share of income so work becomes optional sooner. Your FI number is 25 times a year of spending (the 4% rule). Raising your savings rate is
          the fastest lever: about 17 years at 50% saved, from zero. Tips push harder on cuts.
        </p>
      </div>
      <div>
        <div className="font-semibold">🌿 Soft saving</div>
        <p className="m-0 mt-1" style={{ color: 'var(--muted)' }}>
          Save steadily (around 20%), keep an emergency fund, and spend the rest on what matters to you now without guilt. Tips focus on spending that crept up
          and on bills you forgot, not on cutting the fun.
        </p>
      </div>
      <p className="m-0 text-[11px]" style={{ color: 'var(--subtle)' }}>Rules of thumb calculated on your Mac, not financial advice. You can switch any time.</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: React.ReactNode }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--field-fill)' }}>
      <div className="label-caps" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="mt-1 text-[17px] font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px]" style={{ color: 'var(--muted)' }}>{note}</div>
    </div>
  );
}

function RateBars({ rates, goal }: { rates: (number | null)[]; goal: number }) {
  const h = 44;
  const top = Math.max(goal, ...rates.map((r) => r ?? 0), 1) * 1.1;
  const y = (v: number) => h - (Math.max(0, v) / top) * h;
  return (
    <svg width={rates.length * 9} height={h} role="img" aria-label={`Savings rate, last ${rates.length} months`} className="shrink-0">
      {rates.map((v, i) => {
        const bh = Math.max(3, h - y(v ?? 0));
        return <rect key={i} x={i * 9} y={h - bh} width={5} height={bh} rx={2.5} style={{ fill: (v ?? 0) >= goal ? 'var(--pos)' : 'var(--spend)', opacity: i === rates.length - 1 ? 1 : 0.55 }} />;
      })}
      <line x1={0} x2={rates.length * 9} y1={y(goal)} y2={y(goal)} strokeDasharray="2 3" style={{ stroke: 'var(--muted)' }} />
    </svg>
  );
}

// ---------- Suggested budget ----------

function SuggestedBudget({ ctx }: { ctx: HabitsContext }) {
  const setTarget = useHabitsStore((s) => s.setTarget);
  const loadData = useHabitsStore((s) => s.loadData);
  const choose = useHabitsStore((s) => s.choose);
  const chooseAll = useHabitsStore((s) => s.chooseAll);
  const undoSteps = useUndoStore((s) => s.steps);
  const profileId = useProfileStore((s) => s.activeProfileId);
  const [editing, setEditing] = useState<Record<number, string> | null>(null);
  const [all, setAll] = useState(false);
  const [doneAt, setDone] = useState<{ text: string; steps: number } | null>(null);
  // After ⌘Z or ⇧⌘Z the confirmation no longer describes your budgets.
  const done = doneAt && doneAt.steps === undoSteps ? doneAt.text : null;
  const [error, setError] = useState<string | null>(null);
  // Escape leaves editing, like Cancel.
  const isEditing = editing != null;
  useEffect(() => {
    if (!isEditing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isEditing]);
  const s = suggestBudget(ctx);
  const names = new Map(ctx.categories.map((c) => [c.id, `${c.emoji ? `${c.emoji} ` : ''}${c.name}`]));
  const years = yearsToFi(ctx.target);
  const step = (d: number) => {
    setEditing(null);
    setDone(null);
    void setTarget(ctx.style, ctx.target + d);
  };
  const apply = async () => {
    if (!s) return;
    // Only the budgets that actually change.
    const items = s.rows
      .filter((r) => r.included)
      .map((r) => {
        const typed = editing?.[r.categoryId];
        const dollars = typed == null ? NaN : Number(typed.replace(/[^0-9.]/g, ''));
        return { categoryId: r.categoryId, amountCents: Number.isFinite(dollars) && typed?.trim() ? Math.round(dollars * 100) : r.suggestedCents, currentCents: r.currentCents };
      })
      .filter((i) => i.amountCents !== i.currentCents);
    if (items.length === 0) return;
    const added = items.filter((i) => i.currentCents == null).length;
    const changed = items.length - added;
    const parts = [changed && `${changed} changed`, added && `${added} new`].filter(Boolean).join(', ');
    try {
      await ipc().applyBudgets(ctx.data.currentMonth, items.map(({ categoryId, amountCents }) => ({ categoryId, amountCents })));
      setEditing(null);
      setError(null);
      setDone({ text: `Budgets set: ${parts}. ⌘Z undoes it.`, steps: useUndoStore.getState().steps });
      void loadData(profileId, ctx.today);
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <Card title="Suggested budget" actions={<span className="label-caps" style={{ color: 'var(--muted)' }}>{ctx.style === 'fire' ? 'FIRE' : 'Soft saving'}</span>}>
      {!s ? (
        <p className="m-0 text-[13px]" style={{ color: 'var(--muted)' }}>Needs income in your history to suggest a budget.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Target savings rate</div>
            <div className="flex items-center gap-2">
              <Button aria-label="Lower target" disabled={ctx.target <= MIN_TARGET} onClick={() => step(-5)}>−</Button>
              <span className="w-12 text-center text-[17px] font-semibold tabular-nums">{ctx.target}%</span>
              <Button aria-label="Raise target" disabled={ctx.target >= MAX_TARGET} onClick={() => step(5)}>+</Button>
            </div>
          </div>
          <div className="text-[13px]">
            Spend about <Money cents={s.goalSpendCents} decimals={false} /> a month{' '}
            {s.cutCents > 0 ? (
              <>
                (<Money cents={s.cutCents} decimals={false} tone="neg" /> less than your average)
              </>
            ) : (
              <span style={{ color: 'var(--pos)' }}>(you already do)</span>
            )}
            {ctx.style === 'fire' && years != null && <span style={{ color: 'var(--muted)' }}> · about {Math.round(years)} years to FI</span>}
          </div>
          {s.rows.length > 0 && (
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="label-caps" style={{ color: 'var(--muted)' }}>
                  <th className="w-8 pb-1.5 text-left">
                    {/* Like a Mac list's header checkbox: ticked when all are in, a dash when some are. */}
                    <input
                      type="checkbox"
                      aria-label="Include all categories"
                      checked={s.rows.every((r) => r.included)}
                      ref={(el) => {
                        if (el) el.indeterminate = s.rows.some((r) => r.included) && !s.rows.every((r) => r.included);
                      }}
                      onChange={() => {
                        setDone(null);
                        void chooseAll(s.rows.map((r) => r.categoryId), !s.rows.every((r) => r.included));
                      }}
                    />
                  </th>
                  <th className="whitespace-nowrap pb-1.5 text-left font-semibold">Flexible spending</th>
                  <th className="w-[80px] pb-1.5 text-right font-semibold">Average</th>
                  <th className="w-[80px] pb-1.5 text-right font-semibold">Budget</th>
                  <th className="w-[130px] pb-1.5 text-right font-semibold">Suggested</th>
                </tr>
              </thead>
              <tbody>
                {(all ? s.rows : s.rows.slice(0, SHOWN_ROWS)).map((r) => {
                  const name = names.get(r.categoryId) ?? 'Category';
                  const plain = ctx.categories.find((c) => c.id === r.categoryId)?.name ?? name;
                  return (
                    <tr key={r.categoryId} className="border-t" style={{ borderColor: 'var(--line)', opacity: r.included ? 1 : 0.55 }}>
                      <td className="py-1.5 pr-2 align-middle">
                        <input
                          type="checkbox"
                          aria-label={`Include ${plain} in the budget`}
                          checked={r.included}
                          onChange={(e) => {
                            setDone(null);
                            void choose(r.categoryId, e.target.checked);
                          }}
                        />
                      </td>
                      <td className="py-1.5">
                        {name}
                        {ctx.style === 'soft' && r.creptUp && <span className="ml-1.5 text-[11px]" style={{ color: 'var(--warn)' }}>crept up</span>}
                      </td>
                      <td className="py-1.5 text-right">
                        <Money cents={r.avgCents} decimals={false} tone="muted" />
                      </td>
                      <td className="py-1.5 text-right">
                        {r.currentCents == null ? <span style={{ color: 'var(--subtle)' }}>—</span> : <Money cents={r.currentCents} decimals={false} tone="muted" />}
                      </td>
                      <td className="py-1.5 text-right font-semibold">
                        {!r.included ? (
                          <span className="text-[12px] font-normal" style={{ color: 'var(--muted)' }}>Not budgeted</span>
                        ) : editing ? (
                          <input
                            aria-label={`Suggested budget for ${plain}`}
                            className="field w-[84px] text-right"
                            value={editing[r.categoryId] ?? String(r.suggestedCents / 100)}
                            onChange={(e) => setEditing({ ...editing, [r.categoryId]: e.target.value })}
                          />
                        ) : (
                          <>
                            <Money cents={r.suggestedCents} decimals={false} tone={r.suggestedCents < r.avgCents ? 'pos' : 'default'} />
                            <ChangeMark row={r} />
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {s.reachablePct != null && (
            <div className="text-[12px]" style={{ color: 'var(--warn)' }}>Even halving flexible spending gets you to {s.reachablePct}%.</div>
          )}
          {s.rows.length > SHOWN_ROWS && (
            <button type="button" onClick={() => setAll(!all)} className="-mt-2 self-start text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
              {all ? 'Show fewer' : `Show all ${s.rows.length}`}
            </button>
          )}
          <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            {ctx.style === 'fire'
              ? 'Needs and bills stay as they are; flexible spending is trimmed in proportion to its size, never by more than half.'
              : 'Needs and bills stay as they are; spending that grew over the year is trimmed back first.'}{' '}
            Untick a category to leave it out (small ones start out).
          </div>
          {done && (
            <div role="status" className="text-[12px]" style={{ color: 'var(--pos)' }}>
              {done}
            </div>
          )}
          {error && (
            <div role="alert" className="text-[12px]" style={{ color: 'var(--neg)' }}>
              {error}
            </div>
          )}
          {s.rows.length > 0 && (
            <div className="flex justify-end gap-2">
              {editing ? (
                <Button onClick={() => setEditing(null)}>Cancel</Button>
              ) : (
                <Button onClick={() => { setEditing({}); setDone(null); }}>Adjust</Button>
              )}
              <Button variant="primary" disabled={!editing && !s.rows.some((r) => r.included && r.change !== 'same')} onClick={() => void apply()}>
                Use these budgets
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

const wholeMoney = (cents: number) =>
  new Intl.NumberFormat(localeFor(displayCurrency()), { style: 'currency', currency: displayCurrency(), maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(cents / 100);

/** Next to a suggestion: how it compares with the budget you have now. */
function ChangeMark({ row }: { row: SuggestionRow }) {
  const by = Math.abs(row.suggestedCents - (row.currentCents ?? 0));
  const mark =
    row.change === 'lower' ? { text: `↓ ${wholeMoney(by)}`, color: 'var(--pos)', title: 'Lower than your budget now' }
    : row.change === 'raise' ? { text: `↑ ${wholeMoney(by)}`, color: 'var(--warn)', title: 'Your budget now is below what you can realistically keep to' }
    : row.change === 'same' ? { text: 'same', color: 'var(--subtle)', title: 'Already your budget' }
    : row.change === 'new' ? { text: 'new', color: 'var(--subtle)', title: 'No budget yet' }
    : null;
  if (!mark) return null;
  return (
    <span title={mark.title} className="ml-1.5 inline-block min-w-[44px] text-left text-[11px] font-normal" style={{ color: mark.color }}>
      {mark.text}
    </span>
  );
}

// ---------- Tips ----------

function TipsList({ ctx }: { ctx: HabitsContext }) {
  const hiddenList = useHabitsStore((s) => s.hidden);
  const hide = useHabitsStore((s) => s.hide);
  const unhide = useHabitsStore((s) => s.unhide);
  const [open, setOpen] = useState(false);
  const { shown, hidden } = visibleTips(buildTips(ctx), hiddenList);
  return (
    <section aria-label="Tips for you" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="m-0 text-[14px] font-semibold">Tips for you</h3>
        <span className="text-[11.5px]" style={{ color: 'var(--subtle)' }}>Updated after every import</span>
      </div>
      {shown.length === 0 && <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>No tips right now.</p>}
      <div className="grid grid-cols-2 gap-3">
        {shown.map((t) => (
          <TipCard key={t.id} tip={t} onHide={() => void hide(t, ctx.today)} />
        ))}
      </div>
      {hidden.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="self-start text-[12px] font-semibold" style={{ color: 'var(--muted)' }}>
            {open ? '▾' : '▸'} {hidden.length} hidden {hidden.length === 1 ? 'tip' : 'tips'}
          </button>
          {open && (
            <>
              {hidden.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--line)' }}>
                  <span style={{ color: 'var(--muted)' }}>{t.title}</span>
                  <button type="button" onClick={() => void unhide(t.id)} className="text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
                    Show again
                  </button>
                </div>
              ))}
              <p className="m-0 text-[11.5px]" style={{ color: 'var(--subtle)' }}>A hidden tip also comes back by itself when its numbers change a lot.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function TipCard({ tip: t, onHide, compact = false }: { tip: Tip; onHide?: () => void; compact?: boolean }) {
  const go = useNavStore((s) => s.go);
  return (
    <article aria-label={t.title} className={compact ? 'flex gap-2.5' : 'flex gap-3 rounded-xl border p-4'} style={compact ? undefined : { borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[t.tone] }} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={compact ? 'text-[13px] font-medium' : 'font-medium'}>{t.title}</span>
        <span className={compact ? 'text-[12px]' : 'text-sm'} style={{ color: 'var(--muted)' }}>{t.detail}</span>
        {!compact && t.split && <SplitBar split={t.split} />}
        {!compact && t.link && (
          <button type="button" onClick={() => go(t.link!)} className="mt-1 self-start text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
            {t.link === 'categories' ? 'See categories' : 'Review bills'} ›
          </button>
        )}
      </div>
      {onHide && (
        <button type="button" aria-label="Hide this tip" title="Hide this tip" onClick={onHide} className="self-start opacity-50 hover:opacity-100" style={{ color: 'var(--muted)' }}>
          <IconClose size={12} />
        </button>
      )}
    </article>
  );
}

function SplitBar({ split }: { split: Split }) {
  const parts = [
    { label: 'Needs', pct: split.needs, aim: 50, color: 'var(--spend)' },
    { label: 'Wants', pct: split.wants, aim: 30, color: 'var(--warn)' },
    { label: 'Saved', pct: split.saved, aim: 20, color: 'var(--pos)' },
  ];
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full" style={{ background: 'var(--track)' }}>
        {parts.map((p) => (
          <span key={p.label} style={{ width: `${(Math.max(0, p.pct) / Math.max(100, parts.reduce((t, x) => t + Math.max(0, x.pct), 0))) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--muted)' }}>
        {parts.map((p) => (
          <span key={p.label}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            {p.label} {p.pct}% <span style={{ color: 'var(--subtle)' }}>(aim {p.aim}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
