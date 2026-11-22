import { useScreen } from '@/app/shell/screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SplitPage } from '@/app/shell/page';
import { Money } from '@/components/money';
import { ToolbarButton } from '@/components/toolbar-button';
import { pillColors } from '@/components/category-pill';
import { Chart } from '@/features/charts/chart';
import { budgetHistory } from '@/features/charts/budget-history';
import { Ring } from '@/features/charts/mini-charts';
import { prefersReducedMotion, readChartTokens } from '@/features/charts/tokens';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { BudgetPlan, Category, CategoryGroup, Recurring, Source, Transaction } from '@/lib/types';
import { TransactionRow } from '@/features/transactions/transaction-row';
import { TransactionDrawer } from '@/features/transactions/transaction-drawer';
import { BudgetEditor, GroupBudgetEditor, RebalanceDialog } from './budget-editors';
import { useAnalyticsStore } from './analytics-store';
import { buildCategories, type Row, type Selection } from './categories-model';
import { CategoryLine } from './category-line';
import { AddCategoryMenu } from '@/features/categories/add-category-menu';
import { CategoryActionsMenu } from '@/features/categories/category-actions-menu';
import { GroupActionsMenu } from '@/features/categories/group-actions-menu';
import { EditableTitle } from '@/features/categories/editable-title';
import { EmojiPicker } from '@/features/categories/emoji-picker';
import { DeleteCategoryDialog } from '@/features/categories/delete-category-dialog';
import { normalizedName, realGroups } from '@/lib/category-names';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { CleanUpOther } from './clean-up-other';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');
const same = (a: Selection, b: Selection) => a.kind === b.kind && (a.kind === 'all' || (b.kind !== 'all' && a.id === b.id));

function useCategoriesSource() {
  const profileId = useProfileStore((s) => s.activeProfileId);
  const today = useAnalyticsStore((s) => s.today);
  const { activation } = useScreen();
  const [version, setVersion] = useState(0);
  const [src, setSrc] = useState<{ transactions: Transaction[]; categories: Category[]; groups: CategoryGroup[]; recurring: Recurring[]; plan: BudgetPlan; rolloversOn: boolean; sources: Source[] } | null>(null);
  useEffect(() => {
    let live = true;
    const [y, m] = today.split('-').map(Number);
    void Promise.all([
      ipc().listTransactions({ profileId, from: `${y - 2}-${pad(m)}-01`, to: today }),
      ipc().listCategories(),
      ipc().listCategoryGroups(),
      ipc().listRecurring(profileId),
      ipc().getBudgetPlan(),
      ipc().getSetting('budgets.rollovers'),
      ipc().listSources(),
    ]).then(
      ([transactions, categories, groups, recurring, plan, rollovers, sources]) =>
        live && setSrc({ transactions, categories, groups, recurring, plan, rolloversOn: rollovers === '1', sources }),
    );
    return () => {
      live = false;
    };
  }, [profileId, today, version, activation]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { src, today, reload };
}

export function CategoriesPage() {
  const { src, today, reload } = useCategoriesSource();
  const [selection, setSelection] = useState<Selection>({ kind: 'all' });
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  // A month picked on the detail's history chart ('YYYY-MM'); null shows this month.
  const [pickedMonth, setPickedMonth] = useState<string | null>(null);
  // A transaction opened from a category's list, shown in a side pane.
  const [openTx, setOpenTx] = useState<number | null>(null);
  const closeTx = useCallback(() => setOpenTx(null), []);
  // Asked from the Dashboard: open Clean up and select Other once the data is in.
  const [cleaning, setCleaning] = useState(() => useNavStore.getState().cleanUpOther);
  const [pendingOther, setPendingOther] = useState(cleaning);
  const clearCleanUp = useNavStore((s) => s.clearCleanUpOther);
  useEffect(() => clearCleanUp(), [clearCleanUp]);
  const go = useNavStore((s) => s.go);
  const applyTxFilter = useTransactionsStore((s) => s.applyFilter);
  // A notification asked for a category (or All) in a month: show it once the data is in.
  const intent = useNavStore((s) => s.intent);
  const clearIntent = useNavStore((s) => s.clearIntent);
  const [handledIntent, setHandledIntent] = useState(0);
  if (src && intent?.target.kind === 'category' && intent.seq !== handledIntent) {
    const { id, month } = intent.target;
    setHandledIntent(intent.seq);
    setSelection(id == null ? { kind: 'all' } : { kind: 'category', id });
    setPickedMonth(month === today.slice(0, 7) ? null : month);
  }
  useEffect(() => {
    if (intent?.target.kind === 'category' && intent.seq === handledIntent) clearIntent();
  }, [intent, handledIntent, clearIntent]);

  const model = useMemo(() => (src ? buildCategories({ ...src, today, selection, month: pickedMonth ?? undefined }) : null), [src, today, selection, pickedMonth]);
  const selectedCategory = selection.kind === 'category' ? src?.categories.find((c) => c.id === selection.id) : undefined;
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1];

  const selectedGroup = selection.kind === 'group' ? src?.groups.find((g) => g.id === selection.id) : undefined;
  // After an ungroup, delete or move, the selected item may be gone: fall back to All.
  // Only when it was there before; a just-created category is not loaded yet.
  const previous = useRef<typeof src>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = src;
    if (!src || !before || selection.kind === 'all') return;
    const has = (data: NonNullable<typeof src>) =>
      selection.kind === 'category' ? data.categories.some((c) => c.id === selection.id) : data.groups.some((g) => g.id === selection.id);
    if (has(before) && !has(src)) setSelection({ kind: 'all' });
  }, [src, selection]);
  if (pendingOther && src) {
    setPendingOther(false);
    const other = src.categories.find((c) => c.isOther);
    if (other) setSelection({ kind: 'category', id: other.id });
  }
  const [deleting, setDeleting] = useState<{ category: Category; count: number } | null>(null);
  const startDelete = async (category: Category) => {
    const count = await ipc().categoryUsage(category.id);
    setDeleting({ category, count });
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    await ipc().deleteCategory(deleting.category.id);
    setDeleting(null);
    setSelection({ kind: 'all' });
    reload();
  };

  return (
    <SplitPage
      title="Categories"
      toolbar={
        src && (
          <>
          <ToolbarButton
            aria-label="Rebalance"
            title={(model?.rebalanceLines.length ?? 0) >= 2 ? 'Move budget toward where money is going' : 'Set budgets on two or more categories to rebalance'}
            disabled={(model?.rebalanceLines.length ?? 0) < 2}
            onClick={() => setRebalancing(true)}
          >
            Rebalance
          </ToolbarButton>
          <AddCategoryMenu
            groups={realGroups(src.groups, src.categories)}
            existingNames={src.categories.map((c) => c.name)}
            takenGroupNames={src.groups.map((g) => g.name)}
            onCreated={(id) => {
              reload();
              setSelection({ kind: 'category', id });
            }}
          />
          </>
        )
      }
      list={
        model && (
          <div className="flex flex-col gap-6 px-8 py-8">
            <section aria-label="Budget summary" className="flex items-center justify-between rounded-[10px] border px-8 py-6" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
              <div>
                <div className="text-[18px] font-semibold"><Money cents={model.summary.spentCents} decimals={false} /></div>
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>spent in {monthName}</div>
                {model.summary.expectedCents > 0 && (
                  <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    + <Money cents={model.summary.expectedCents} decimals={false} /> expected
                  </div>
                )}
              </div>
              <Ring value={model.summary.spentCents} total={model.summary.budgetCents} label="Spent vs budget" color={model.summary.spentCents > model.summary.budgetCents ? 'var(--warn)' : 'var(--accent)'} />
              <div className="text-right">
                <div className="text-[18px] font-semibold"><Money cents={model.summary.budgetCents} decimals={false} /></div>
                <div className="text-[12px]" style={{ color: 'var(--muted)' }}>total budget</div>
              </div>
            </section>

            <div>
              <div className="mb-2 flex items-center text-[11px] font-semibold uppercase tracking-[0.04em]" style={{ color: 'var(--muted)' }}>
                <button type="button" className="flex-1 text-left text-[14px] font-semibold normal-case tracking-normal" style={{ color: 'var(--text)' }} onClick={() => setSelection({ kind: 'all' })}>
                  Regular categories
                </button>
                <span className="w-[64px] text-right">Spent</span>
                <span className="mx-3 w-[150px]" />
                <span className="w-[56px] text-right">Budget</span>
              </div>
              <div role="grid" aria-label="Categories">
                {model.tree.map((g) => {
                  const open = !collapsed[g.group.id];
                  // A category alone in a group of its own name is a top-level category: one row.
                  const solo = g.children.length === 1 && normalizedName(g.children[0].category.name) === normalizedName(g.group.name);
                  if (solo) {
                    const c = g.children[0];
                    return (
                      <div key={g.group.id} role="rowgroup">
                        <CategoryLine
                          depth={0}
                          name={c.category.name}
                          emoji={c.category.emoji}
                          color={c.category.color ?? g.group.color}
                          spentCents={c.spentCents}
                          expectedCents={c.expectedCents}
                          budgetCents={c.budgetCents}
                          selected={same(selection, { kind: 'category', id: c.category.id })}
                          onSelect={() => setSelection({ kind: 'category', id: c.category.id })}
                          barWidth={150}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={g.group.id} role="rowgroup">
                      <CategoryLine
                        depth={0}
                        name={g.group.name}
                        emoji={g.group.emoji}
                        color={g.group.color}
                        badge={g.children.length}
                        spentCents={g.spentCents}
                        expectedCents={g.expectedCents}
                        budgetCents={g.budgetCents}
                        toggle={() => setCollapsed({ ...collapsed, [g.group.id]: open })}
                        open={open}
                        selected={same(selection, { kind: 'group', id: g.group.id })}
                        onSelect={() => setSelection({ kind: 'group', id: g.group.id })}
                        barWidth={150}
                      />
                      {open &&
                        g.children.map((c) => (
                          <CategoryLine
                            key={c.category.id}
                            depth={1}
                            name={c.category.name}
                            emoji={c.category.emoji}
                            color={c.category.color ?? g.group.color}
                            spentCents={c.spentCents}
                            expectedCents={c.expectedCents}
                            budgetCents={c.budgetCents}
                            selected={same(selection, { kind: 'category', id: c.category.id })}
                            onSelect={() => setSelection({ kind: 'category', id: c.category.id })}
                            barWidth={132}
                          />
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>

            {model.income.length > 0 && (
              <div>
                <div className="mb-2 text-[14px] font-semibold">Income</div>
                <div role="grid" aria-label="Income">
                  {model.income.map((c) => (
                    <CategoryLine
                      key={c.category.id}
                      depth={0}
                      name={c.category.name}
                      emoji={c.category.emoji}
                      color={c.category.color ?? src?.groups.find((g) => g.id === c.category.groupId)?.color ?? '#57bd57'}
                      spentCents={c.spentCents}
                      budgetCents={null}
                      selected={same(selection, { kind: 'category', id: c.category.id })}
                      onSelect={() => setSelection({ kind: 'category', id: c.category.id })}
                      barWidth={150}
                    />
                  ))}
                </div>
              </div>
            )}

            {model.excluded.length > 0 && (
              <div>
                <div className="mb-2 text-[14px] font-semibold">Excluded</div>
                <div role="grid" aria-label="Excluded">
                  {model.excluded.map((c) => (
                    <CategoryLine
                      key={c.category.id}
                      depth={0}
                      name={c.category.name}
                      emoji={c.category.emoji}
                      color={c.category.color ?? src?.groups.find((g) => g.id === c.category.groupId)?.color ?? '#617598'}
                      spentCents={c.spentCents}
                      budgetCents={null}
                      selected={same(selection, { kind: 'category', id: c.category.id })}
                      onSelect={() => setSelection({ kind: 'category', id: c.category.id })}
                      barWidth={150}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      }
      detailActions={
        <>
          <ToolbarButton active={editing} aria-pressed={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'Done' : 'Edit budget'}
          </ToolbarButton>
          {selectedCategory?.isOther && (
            <ToolbarButton active={cleaning} aria-pressed={cleaning} onClick={() => setCleaning(!cleaning)}>
              Clean up
            </ToolbarButton>
          )}
          {selectedCategory && src && (
            <CategoryActionsMenu category={selectedCategory} groups={realGroups(src.groups, src.categories)} onChanged={reload} onDelete={() => void startDelete(selectedCategory)} />
          )}
          {selectedGroup && <GroupActionsMenu group={selectedGroup} onChanged={reload} />}
        </>
      }
      detail={
        cleaning && src && (selectedCategory?.isOther || (selection.kind === 'all' && !src.categories.some((c) => c.isOther))) ? (
          <CleanUpOther
            categories={src.categories}
            categoriesById={Object.fromEntries(src.categories.map((c) => [c.id, c]))}
            onChanged={reload}
            onReviewEach={(platform) => {
              go('transactions');
              void applyTxFilter({ text: platform });
            }}
          />
        ) : model && (
          <CategoryDetail
            model={model}
            monthName={monthName}
            editing={editing}
            onSaved={reload}
            onSelect={setSelection}
            category={selectedCategory}
            group={selectedGroup}
            plan={src?.plan ?? { months: [], groups: [], rollovers: [] }}
            rolloversOn={src?.rolloversOn ?? false}
            thisMonth={today.slice(0, 7)}
            onPickMonth={setPickedMonth}
            sources={src?.sources ?? []}
            onOpenTransaction={setOpenTx}
          />
        )
      }
      overlay={
        rebalancing && model && src ? (
          <RebalanceDialog
            lines={model.rebalanceLines}
            categories={src.categories}
            colorOf={(c) => c.color ?? src.groups.find((g) => g.id === c.groupId)?.color ?? '#77a5f2'}
            thisMonth={today.slice(0, 7)}
            onClose={() => setRebalancing(false)}
            onSaved={reload}
          />
        ) : deleting ? (
          <DeleteCategoryDialog category={deleting.category} count={deleting.count} otherName={src?.categories.find((c) => c.isOther)?.name} onConfirm={() => void confirmDelete()} onCancel={() => setDeleting(null)} />
        ) : (
          openTx != null && <TransactionDrawer id={openTx} onOpen={setOpenTx} onClose={closeTx} onChanged={reload} />
        )
      }
    />
  );
}

function CategoryDetail({
  model,
  monthName,
  editing,
  onSaved,
  onSelect,
  category,
  group,
  plan,
  rolloversOn,
  thisMonth,
  onPickMonth,
  sources,
  onOpenTransaction,
}: {
  model: NonNullable<ReturnType<typeof buildCategories>>;
  monthName: string;
  editing: boolean;
  onSaved: () => void;
  onSelect: (s: Selection) => void;
  /** The selected category, when one is selected: its name and emoji are editable here. */
  category?: Category;
  /** The selected group, when one is selected. */
  group?: CategoryGroup;
  plan: BudgetPlan;
  rolloversOn: boolean;
  thisMonth: string;
  /** Pick a month on the history chart; null goes back to this month. */
  onPickMonth: (month: string | null) => void;
  sources: Source[];
  onOpenTransaction: (id: number) => void;
}) {
  const d = model.detail;
  const picked = d.month !== thisMonth ? d.month : undefined;
  const groupLine = group ? model.tree.find((g) => g.group.id === group.id) : undefined;
  const sharedGroups = new Set(plan.groups.map((g) => g.groupId));
  const tokens = readChartTokens();
  const option = useMemo(() => budgetHistory(d.history, tokens, { reduceMotion: prefersReducedMotion(), picked }), [d.history, tokens, picked]);
  const shown = d.members.slice(0, 4);
  return (
    <article className="flex flex-col gap-7 px-8 py-8">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          {category ? (
            <div className="mb-3 flex items-center gap-3">
              <EmojiPicker value={category.emoji} size={26} onChange={(emoji) => void ipc().updateCategory(category.id, { emoji }).then(onSaved)} />
              <EditableTitle key={category.id} value={category.name} onSave={async (name) => { await ipc().updateCategory(category.id, { name }); onSaved(); }} />
            </div>
          ) : (
            <h2 className="m-0 mb-3 text-[24px] font-semibold">{d.title}</h2>
          )}
          <div className="flex flex-wrap gap-1.5">
            {shown.map((mb) => (
              <span key={mb.name} className="rounded-full px-2.5 py-[3px] text-[10px] font-semibold uppercase" style={pillColors(mb.color)}>
                {mb.emoji ? `${mb.emoji} ` : ''}
                {mb.name}
              </span>
            ))}
            {d.members.length > shown.length && (
              <span className="rounded-full px-2.5 py-[3px] text-[10px] font-semibold" style={pillColors('var(--accent)')}>+{d.members.length - shown.length}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] font-semibold">Spent in {picked ? `${FULL_MONTHS[Number(picked.slice(5, 7)) - 1]} ${picked.slice(0, 4)}` : monthName}</div>
          <div className="text-[20px] font-semibold"><Money cents={d.spentCents} /></div>
          {d.leftCents != null && (
            <div className="text-[12px]" style={{ color: d.leftCents < 0 ? 'var(--warn)' : 'var(--muted)' }}>
              <Money cents={Math.abs(d.leftCents)} decimals={false} tone={d.leftCents < 0 ? 'neg' : 'muted'} /> {d.leftCents < 0 ? 'over' : 'left'}
            </div>
          )}
          {rolloversOn && d.rolloverCents !== 0 && (
            <div className="text-[12px]" style={{ color: 'var(--muted)' }}>
              Rollover {d.rolloverCents > 0 ? '+' : '-'}
              <Money cents={Math.abs(d.rolloverCents)} decimals={false} tone="muted" />
            </div>
          )}
        </div>
      </header>

      {editing && category && category.kind === 'expense' && !category.excluded && (
        sharedGroups.has(category.groupId) ? (
          <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>This category shares its group's budget. Edit the group to change it.</p>
        ) : (
          <BudgetEditor key={`${category.id}-${category.budgetCents}`} category={category} plan={plan} thisMonth={thisMonth} rolloversOn={rolloversOn} onSaved={onSaved} />
        )
      )}
      {editing && group && groupLine && groupLine.children.length >= 2 && (
        <GroupBudgetEditor
          key={group.id}
          groupId={group.id}
          name={group.name}
          currentCents={plan.groups.find((g) => g.groupId === group.id)?.amountCents ?? null}
          sumCents={groupLine.children.reduce<number | null>((s, c) => (c.category.budgetCents == null ? s : (s ?? 0) + c.category.budgetCents), null)}
          onSaved={onSaved}
        />
      )}

      <div role="img" aria-label="Budget history" className="-mx-8">
        <Chart
          option={option}
          height={110}
          onClick={(p) => {
            const month = d.history[p.dataIndex]?.month;
            if (month) onPickMonth(month === thisMonth || month === picked ? null : month);
          }}
        />
      </div>
      {picked && (
        <button type="button" onClick={() => onPickMonth(null)} className="-mt-5 self-start text-[12px] font-semibold" style={{ color: 'var(--accent)' }}>
          Back to this month
        </button>
      )}

      <table aria-label="Key metrics" className="w-full border-t text-[13px]" style={{ borderColor: 'var(--line)' }}>
        <thead>
          <tr style={{ color: 'var(--muted)' }}>
            <th className="pb-2 pt-5 text-left font-semibold" style={{ color: 'var(--text)' }}>Key metrics</th>
            <th className="pb-2 pt-5 text-right font-medium">Spent per year</th>
            <th className="pb-2 pt-5 text-right font-medium">Avg monthly spend</th>
          </tr>
        </thead>
        <tbody>
          {d.years.map((y) => (
            <tr key={y.year}>
              <td className="py-1.5" style={{ color: 'var(--accent)' }}>{y.year}</td>
              <td className="py-1.5 text-right font-semibold"><Money cents={y.spendCents} /></td>
              <td className="py-1.5 text-right font-semibold"><Money cents={y.avgMonthlySpendCents} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {category ? (
        <CategoryTransactions name={category.name} category={category} months={d.transactionsByMonth} sources={sources} onOpen={onOpenTransaction} />
      ) : (
      <table aria-label="Category budgets" className="w-full border-t text-[13px]" style={{ borderColor: 'var(--line)' }}>
        <thead>
          <tr className="text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--muted)' }}>
            <th className="pb-2 pt-5 text-left text-[14px] font-semibold normal-case tracking-normal" style={{ color: 'var(--text)' }}>{d.title}</th>
            <th className="pb-2 pt-5 text-right font-semibold">Spent</th>
            <th className="pb-2 pt-5 text-right font-semibold">Budget</th>
            <th className="pb-2 pt-5 text-right font-semibold">Left</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((r) => (
            <BudgetRow key={`${r.selection.kind}-${r.name}`} row={r} editing={editing && !category} onSaved={onSaved} onSelect={onSelect} plan={plan} categories={model.tree.flatMap((g) => g.children.map((c) => c.category))} />
          ))}
        </tbody>
      </table>
      )}
    </article>
  );
}

/** Copilot's list under a category: its transactions, a heading per month, newest first. */
function CategoryTransactions({ name, category, months, sources, onOpen: open }: { name: string; category: Category; months: { month: string; transactions: Transaction[] }[]; sources: Source[]; onOpen: (id: number) => void }) {
  return (
    <div role="grid" aria-label={`${name} transactions`} className="-mx-8 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
      {months.length === 0 && (
        <p className="m-0 px-8 pt-4 text-[13px]" style={{ color: 'var(--muted)' }}>No transactions.</p>
      )}
      {months.map((m) => (
        <div key={m.month} role="rowgroup" className="pb-2">
          <h3 className="m-0 px-8 pb-2 pt-5 text-[14px] font-semibold">{FULL_MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</h3>
          <div className="pl-4">
            {m.transactions.map((t) => (
              <TransactionRow
                key={t.id}
                tx={t}
                category={category}
                source={sources.find((x) => x.id === t.sourceId)}
                selected={false}
                active={false}
                selectable={false}
                showDate
                onToggleSelect={() => {}}
                onOpen={() => open(t.id)}
                onPickCategory={() => open(t.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function BudgetRow({ row, editing, onSaved, onSelect, plan, categories }: { row: Row; editing: boolean; onSaved: () => void; onSelect: (s: Selection) => void; plan: BudgetPlan; categories: Category[] }) {
  const id = row.selection.kind === 'category' ? row.selection.id : null;
  const groupId = categories.find((c) => c.id === id)?.groupId;
  // Under a shared group budget a category has no budget of its own to edit here.
  const sharedMember = groupId != null && plan.groups.some((g) => g.groupId === groupId);
  // With budgets per month, the table would overwrite them: edit those in the category's panel.
  const perMonth = id != null && plan.months.some((m) => m.categoryId === id);
  const editable = editing && row.selection.kind === 'category' && !sharedMember;
  return (
    <tr className="h-[26px]">
      <td style={{ paddingLeft: row.depth * 18 }}>
        <button type="button" onClick={() => onSelect(row.selection)} className="rounded-full px-2 py-[2px] text-[10px] font-semibold uppercase" style={pillColors(row.color)}>
          {row.emoji ? `${row.emoji} ` : ''}
          {row.name}
        </button>
      </td>
      <td className="text-right font-semibold"><Money cents={row.spentCents} /></td>
      <td className="text-right font-semibold">
        {editable && row.selection.kind === 'category' ? (
          <BudgetInput categoryId={row.selection.id} name={row.name} budgetCents={row.budgetCents} onSaved={onSaved} disabled={perMonth} />
        ) : row.budgetCents != null ? (
          <Money cents={row.budgetCents} />
        ) : (
          <span style={{ color: 'var(--subtle)' }}>-</span>
        )}
      </td>
      <td className="text-right font-semibold">
        {row.leftCents != null ? (
          <span className="inline-flex items-center gap-1.5">
            <Money cents={row.leftCents} sign="negative" tone={row.leftCents < 0 ? 'neg' : 'default'} />
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: row.leftCents < 0 ? 'var(--warn)' : 'var(--pos)' }} />
          </span>
        ) : (
          <span style={{ color: 'var(--subtle)' }}>-</span>
        )}
      </td>
    </tr>
  );
}

/** Dollar input for one category's budget; saves on Enter or blur. Empty clears the budget. */
function BudgetInput({ categoryId, name, budgetCents, onSaved, disabled = false }: { categoryId: number; name: string; budgetCents: number | null; onSaved: () => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(budgetCents != null ? String(Math.round(budgetCents / 100)) : '');
  const commit = async () => {
    const trimmed = draft.trim().replace(/[$,]/g, '');
    const next = trimmed === '' ? null : Math.round(Number(trimmed) * 100);
    if (next != null && Number.isNaN(next)) return;
    if (next === budgetCents || disabled) return;
    await ipc().setBudget(categoryId, null, next);
    onSaved();
  };
  return (
    <input
      aria-label={`Budget for ${name}`}
      disabled={disabled}
      title={disabled ? 'This category has budgets per month: edit it in its own panel' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => e.key === 'Enter' && void commit()}
      inputMode="decimal"
      className="w-[80px] rounded-md border bg-transparent px-2 py-0.5 text-right text-[13px] outline-none"
      style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}
    />
  );
}
