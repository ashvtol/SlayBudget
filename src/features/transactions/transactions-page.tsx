import { useCallback, useEffect, useMemo, useState } from 'react';
import { SplitPage } from '@/app/shell/page';
import { ToolbarButton } from '@/components/toolbar-button';
import { IconCheck, IconClose, IconFilter, IconPlus, IconSearch, IconSort, IconTrash } from '@/components/icons';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useProfileStore } from '@/lib/stores/profile-store';
import { CategoryPicker } from './category-picker';
import { DetailActions, DetailPane } from './detail-pane';
import { FilterChips, SearchField, SortMenu } from './filter-bar';
import { FilterMenu } from './filter-menu';
import { TagPicker } from './tag-picker';
import { isFiltered } from './filter-model';
import { TransactionsList } from './transactions-list';
import { useTransactionsStore } from './transactions-store';
import { useScreen } from '@/app/shell/screen';
import type { TxType } from '@/lib/types';

const TYPE_OPTIONS: [TxType, string][] = [
  ['regular', 'Regular'],
  ['income', 'Income'],
  ['transfer', 'Internal transfer'],
];

export function TransactionsPage() {
  const activeProfile = useProfileStore((s) => s.activeProfileId);
  const load = useTransactionsStore((s) => s.load);
  const transactions = useTransactionsStore((s) => s.transactions);
  const selected = useTransactionsStore((s) => s.selected);
  const toggleSelect = useTransactionsStore((s) => s.toggleSelect);
  const toggleReviewed = useTransactionsStore((s) => s.toggleReviewed);
  const clearSelection = useTransactionsStore((s) => s.clearSelection);
  const deleteTransactions = useTransactionsStore((s) => s.deleteTransactions);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hasText = useTransactionsStore((s) => Boolean(s.filter.text));
  const filtered = useTransactionsStore((s) => isFiltered(s.filter));

  const [openId, setOpenId] = useState<number | null>(null);
  const [pickerId, setPickerId] = useState<number | null>(null);
  const [popover, setPopover] = useState<'filter' | 'sort' | 'type' | 'tag' | null>(null);
  const setType = useTransactionsStore((s) => s.setType);
  const [searchOpen, setSearchOpen] = useState(false);

  // Shown again after another screen: refresh in the background, keeping the view.
  const { active, activation } = useScreen();
  const refresh = useTransactionsStore((s) => s.refresh);
  useEffect(() => {
    if (activation > 0) void refresh();
  }, [activation, refresh]);

  // Coming back to the screen keeps the filters set earlier (or by another screen).
  useEffect(() => {
    const kept = { ...useTransactionsStore.getState().filter };
    delete kept.profileId;
    void load(activeProfile, kept);
  }, [activeProfile, load]);

  // The detail panel is always visible: fall back to the newest transaction.
  const shownId = useMemo(() => {
    if (openId != null && transactions.some((t) => t.id === openId)) return openId;
    return transactions[0]?.id ?? null;
  }, [openId, transactions]);

  const selectedIds = [...selected];
  const allSelected = transactions.length > 0 && transactions.every((t) => selected.has(t.id));
  const selectAll = () => {
    if (allSelected) clearSelection();
    else for (const t of transactions) if (!selected.has(t.id)) toggleSelect(t.id);
  };
  const closePopover = useCallback(() => setPopover(null), []);

  const toolbar = (
    <>
      <div className="relative">
        <ToolbarButton icon={filtered ? IconPlus : IconFilter} aria-label={filtered ? '+ Filter' : 'Filter'} active={popover === 'filter'} onClick={() => setPopover(popover === 'filter' ? null : 'filter')}>
          Filter
        </ToolbarButton>
        {popover === 'filter' && <FilterMenu onClose={closePopover} />}
      </div>
      <div className="relative">
        <ToolbarButton icon={IconSort} active={popover === 'sort'} onClick={() => setPopover(popover === 'sort' ? null : 'sort')}>
          Sort
        </ToolbarButton>
        {popover === 'sort' && <SortMenu onClose={closePopover} />}
      </div>
      <ToolbarButton icon={IconSearch} aria-label="Search" active={searchOpen || hasText} aria-pressed={searchOpen} onClick={() => setSearchOpen(!searchOpen)} />
      {selectedIds.length > 0 && (
        <>
          <span className="ml-2 shrink-0 whitespace-nowrap text-[12px]" style={{ color: 'var(--muted)' }}>{selectedIds.length} selected</span>
          <ToolbarButton icon={IconCheck} aria-label="Mark reviewed" title="Mark reviewed" onClick={() => void toggleReviewed(selectedIds)} />
          <div className="relative">
            <ToolbarButton aria-label="Set type" active={popover === 'type'} onClick={() => setPopover(popover === 'type' ? null : 'type')}>
              Type
            </ToolbarButton>
            {popover === 'type' && (
              <div role="menu" aria-label="Set type" className="absolute left-0 top-[34px] z-30 w-[180px] rounded-lg border p-1.5 shadow-2xl" style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)' }}>
                {TYPE_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closePopover();
                      void setType(selectedIds, value);
                    }}
                    className="flex h-[28px] w-full items-center rounded-md px-2 text-left text-[13px] hover:bg-[var(--hover)]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <ToolbarButton aria-label="Tag" active={popover === 'tag'} onClick={() => setPopover(popover === 'tag' ? null : 'tag')}>
              Tag
            </ToolbarButton>
            {popover === 'tag' && <TagPicker ids={selectedIds} onClose={closePopover} className="left-0 top-[34px]" />}
          </div>
          <ToolbarButton icon={IconTrash} aria-label="Delete selected" title="Delete selected" onClick={() => setConfirmDelete(true)} />
          <ToolbarButton icon={IconClose} aria-label="Clear selection" title="Clear selection" onClick={clearSelection} />
          {confirmDelete && (
            <ConfirmDialog
              title={selectedIds.length === 1 ? 'Delete this transaction?' : `Delete ${selectedIds.length} transactions?`}
              body="Their categories, notes and tags go too. A backup of your data is made first."
              confirmLabel="Delete"
              onCancel={() => setConfirmDelete(false)}
              onConfirm={() => {
                setConfirmDelete(false);
                void deleteTransactions(selectedIds);
              }}
            />
          )}
        </>
      )}
    </>
  );

  return (
    <SplitPage
      title="All transactions"
      leading={
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={selectAll}
          className="h-[13px] w-[13px] shrink-0 accent-[var(--accent)]"
        />
      }
      toolbar={toolbar}
      list={
        <div className="relative flex h-full flex-col">
          {(searchOpen || hasText) && <SearchField />}
          <FilterChips />
          <TransactionsList paused={!active || popover !== null || pickerId != null} onOpen={setOpenId} onPickCategory={setPickerId} onFilters={() => setPopover('filter')} activeId={shownId} />
          {pickerId != null && <CategoryPicker transactionId={pickerId} onClose={() => setPickerId(null)} />}
        </div>
      }
      detailTitle="Transaction"
      detailActions={shownId != null ? <DetailActions id={shownId} /> : undefined}
      detail={<DetailPane id={shownId} onPickCategory={setPickerId} onOpen={setOpenId} />}
    />
  );
}
