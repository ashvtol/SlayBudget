import { useMemo } from 'react';
import { CategoryMenu } from '@/components/category-menu';
import { ipc } from '@/lib/ipc';
import { useTransactionsStore } from './transactions-store';

/** Popover to assign a category to a transaction: search, grouped list, create new. */
export function CategoryPicker({ transactionId, onClose }: { transactionId: number; onClose: () => void }) {
  const categoriesById = useTransactionsStore((s) => s.categoriesById);
  const setCategory = useTransactionsStore((s) => s.setCategory);
  const reload = useTransactionsStore((s) => s.load);
  const filter = useTransactionsStore((s) => s.filter);
  const categories = useMemo(() => Object.values(categoriesById), [categoriesById]);

  async function pick(id: number | null) {
    if (id != null) await setCategory(transactionId, id);
    onClose();
  }

  async function create(name: string) {
    const id = await ipc().createCategory({ group: 'Other', name });
    await reload(filter.profileId ?? null, filter);
    await pick(id);
  }

  return (
    <CategoryMenu
      className="absolute right-6 top-20 max-h-[70vh]"
      categories={categories}
      onPick={(id) => void pick(id)}
      onClose={onClose}
      onCreate={(name) => void create(name)}
    />
  );
}
