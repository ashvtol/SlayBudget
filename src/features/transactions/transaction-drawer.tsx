import { useEffect, useState } from 'react';
import { Drawer } from '@/components/drawer';
import { CategoryPicker } from './category-picker';
import { DetailPane, ReviewButton } from './detail-pane';
import { useTransactionsStore } from './transactions-store';

/**
 * Copilot's transaction side pane, for pages outside Transactions (e.g. a category's list):
 * the same editable detail, over the page. `onChanged` fires after any edit so the page can refresh.
 */
export function TransactionDrawer({ id, onOpen, onClose, onChanged }: { id: number; onOpen: (id: number) => void; onClose: () => void; onChanged: () => void }) {
  const tx = useTransactionsStore((s) => s.byId(id));
  const [pickerId, setPickerId] = useState<number | null>(null);

  // The detail reads the transactions store; load the row there if it isn't yet.
  useEffect(() => {
    if (!useTransactionsStore.getState().byId(id)) void useTransactionsStore.getState().focusById(id);
  }, [id]);

  // Edits update the store's rows; tell the page so its totals follow.
  useEffect(
    () =>
      useTransactionsStore.subscribe((s, prev) => {
        if (s.transactions !== prev.transactions && !s.loading) onChanged();
      }),
    [onChanged],
  );

  return (
    <Drawer open onClose={onClose} title={tx?.recurringId != null ? 'Recurring transaction' : 'Transaction'} actions={tx ? <ReviewButton id={id} /> : undefined}>
      <div className="relative">
        <DetailPane id={id} onPickCategory={setPickerId} onOpen={onOpen} />
        {pickerId != null && <CategoryPicker transactionId={pickerId} onClose={() => setPickerId(null)} />}
      </div>
    </Drawer>
  );
}
