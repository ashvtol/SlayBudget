import { useMemo, useState } from 'react';
import { Money } from '@/components/money';
import { pillColors } from '@/components/category-pill';
import { Segmented } from '@/components/segmented';
import { Modal } from '@/features/recurrings/recurring-form';
import { ipc } from '@/lib/ipc';
import { proposeRebalance, type RebalanceLine } from '@/lib/budget-plan';
import type { BudgetPlan, Category, RebalanceScope } from '@/lib/types';
import { Select } from '@/components/select';
import { Button } from '@/components/button';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** "450" or "$1,200.50" -> cents; "" -> null; anything else -> NaN. */
function parseDollars(text: string): number | null {
  const t = text.trim().replace(/[$,]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : Number.NaN;
}
const dollars = (cents: number | null) => (cents == null ? '' : String(cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)));

const fieldClass = 'h-[28px] rounded-md border bg-transparent px-2 text-[13px] outline-none';
const fieldStyle = { borderColor: 'var(--line-strong)', color: 'var(--text)', background: 'var(--bg)' } as const;

/**
 * Copilot's inline budget editor for one category: "Same budget for all months" or "Different
 * budgets per month" (with a month), the amount, rollover when rollovers are on, and Save budget.
 */
export function BudgetEditor({ category, plan, thisMonth, rolloversOn, onSaved }: { category: Category; plan: BudgetPlan; thisMonth: string; rolloversOn: boolean; onSaved: () => void }) {
  const overrides = plan.months.filter((m) => m.categoryId === category.id);
  const budgetIn = (month: string) => overrides.find((m) => m.month === month)?.amountCents ?? category.budgetCents;
  const rollingSince = plan.rollovers.find((r) => r.categoryId === category.id)?.since ?? null;

  const [mode, setMode] = useState<'all' | 'month'>(overrides.length ? 'month' : 'all');
  const [month, setMonth] = useState(thisMonth);
  const [amount, setAmount] = useState(dollars(overrides.length ? budgetIn(thisMonth) : category.budgetCents));
  const [rollover, setRollover] = useState(rollingSince != null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const months = useMemo(() => {
    const next = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, i));
    return [...new Set([...next, ...overrides.map((m) => m.month)])].sort();
  }, [thisMonth, overrides]);

  const cents = parseDollars(amount);
  const save = async () => {
    if (Number.isNaN(cents)) {
      setError('Enter an amount in dollars, or leave it empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await ipc().setBudget(category.id, mode === 'all' ? null : month, cents);
      if (rolloversOn && rollover !== (rollingSince != null)) await ipc().setRollover(category.id, rollover ? thisMonth : null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Edit budget" className="flex flex-col gap-2.5 rounded-[10px] border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Budget period" value={mode === 'all' ? 'Same budget for all months' : 'Different budgets per month'} onChange={(e) => {
            const next = e.target.value === 'Same budget for all months' ? 'all' : 'month';
            setMode(next);
            setAmount(dollars(next === 'all' ? category.budgetCents : budgetIn(month)));
          }}>
          <option>Same budget for all months</option>
          <option>Different budgets per month</option>
        </Select>
        {mode === 'month' && (
          <Select aria-label="Month" value={month} onChange={(e) => {
              setMonth(e.target.value);
              setAmount(dollars(budgetIn(e.target.value)));
            }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[13px]" style={{ color: 'var(--muted)' }}>$</span>
        <input
          aria-label="Budget amount"
          value={amount}
          inputMode="decimal"
          placeholder={mode === 'month' ? `Default ${dollars(category.budgetCents) || 'none'}` : 'No budget'}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          className={`${fieldClass} w-[120px] text-right`}
          style={fieldStyle}
        />
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          Save budget
        </Button>
      </div>
      {mode === 'month' && (
        <p className="m-0 text-[11px]" style={{ color: 'var(--subtle)' }}>Empty uses the budget for all months.</p>
      )}
      {rolloversOn && (
        <label className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text)' }}>
          <input type="checkbox" checked={rollover} onChange={(e) => setRollover(e.target.checked)} className="accent-[var(--accent)]" />
          Roll over unspent budget
        </label>
      )}
      {error && (
        <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>
      )}
    </section>
  );
}

/** One budget shared by a group's categories; empty goes back to the sum of its categories. */
export function GroupBudgetEditor({ groupId, name, currentCents, sumCents, onSaved }: { groupId: number; name: string; currentCents: number | null; sumCents: number | null; onSaved: () => void }) {
  const [amount, setAmount] = useState(dollars(currentCents));
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const cents = parseDollars(amount);
    if (Number.isNaN(cents)) {
      setError('Enter an amount in dollars, or leave it empty.');
      return;
    }
    try {
      await ipc().setGroupBudget(groupId, cents);
      setError(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section aria-label="Edit budget" className="flex flex-col gap-2.5 rounded-[10px] border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="text-[13px] font-semibold">Shared group budget</div>
      <div className="flex items-center gap-2">
        <span className="text-[13px]" style={{ color: 'var(--muted)' }}>$</span>
        <input
          aria-label={`Shared budget for ${name}`}
          value={amount}
          inputMode="decimal"
          placeholder={sumCents != null ? `Sum: ${dollars(sumCents)}` : 'Sum of its categories'}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
          className={`${fieldClass} w-[120px] text-right`}
          style={fieldStyle}
        />
        <Button variant="primary" onClick={() => void save()}>
          Save budget
        </Button>
      </div>
      <p className="m-0 text-[11px]" style={{ color: 'var(--subtle)' }}>One budget for all of its categories. Empty uses the sum of their budgets.</p>
      {error && (
        <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>
      )}
    </section>
  );
}

const SCOPES = [
  { id: 'thisMonth' as const, label: 'Only this month' },
  { id: 'fromNowOn' as const, label: 'From now on' },
];

/** Copilot's Rebalance: preview moving budget toward where money is going, keeping the total. */
export function RebalanceDialog({ lines, categories, colorOf, thisMonth, onClose, onSaved }: { lines: RebalanceLine[]; categories: Category[]; colorOf: (c: Category) => string; thisMonth: string; onClose: () => void; onSaved: () => void }) {
  const changes = useMemo(() => proposeRebalance(lines), [lines]);
  const [scope, setScope] = useState<RebalanceScope>('thisMonth');
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const ordered = [...changes].sort((a, b) => b.toCents - b.fromCents - (a.toCents - a.fromCents));
  const save = async () => {
    try {
      await ipc().applyRebalance(changes.map((c) => ({ categoryId: c.categoryId, amountCents: c.toCents })), scope, thisMonth);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Modal label="Preview budget changes" onClose={onClose}>
      <p className="m-0 mb-4 text-[12px]" style={{ color: 'var(--muted)' }}>These changes will balance your budgets without changing your total budget amount.</p>
      <div className="mb-4 flex justify-center">
        <Segmented options={SCOPES} value={scope} onChange={setScope} aria-label="Apply to" />
      </div>
      {changes.length === 0 ? (
        <p className="m-0 py-3 text-center text-[13px]" style={{ color: 'var(--muted)' }}>Your budgets already match your spending.</p>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {ordered.map((c) => {
              const category = byId.get(c.categoryId);
              const delta = c.toCents - c.fromCents;
              const pct = c.fromCents > 0 ? Math.round((Math.abs(delta) / c.fromCents) * 100) : 100;
              return (
                <tr key={c.categoryId} className="h-[28px]">
                  <td>
                    <span className="rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase" style={pillColors(category ? colorOf(category) : '#8e8e93')}>
                      {category?.emoji ? `${category.emoji} ` : ''}
                      {category?.name ?? 'Category'}
                    </span>
                  </td>
                  <td className="text-right font-semibold">
                    {delta > 0 ? '+' : '-'}
                    <Money cents={Math.abs(delta)} decimals={false} />
                  </td>
                  <td className="w-[70px] text-right font-semibold" style={{ color: delta > 0 ? 'var(--pos)' : 'var(--neg)' }}>
                    {pct}% {delta > 0 ? '▲' : '▼'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && (
        <p role="alert" className="m-0 mt-3 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>
      )}
      <div className="mt-5 flex justify-end gap-2 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
        <Button onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={changes.length === 0} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Modal>
  );
}
