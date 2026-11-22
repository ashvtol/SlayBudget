// Opening a notification's view: the bell and clicked macOS banners both come here.
import type { NotificationTarget } from '@/lib/types';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { clearAllPatch } from '@/features/transactions/filter-model';
import { useUpdateStore } from '@/features/updates/update-store';
import { ipc } from '@/lib/ipc';
import { DUPLICATE_TAG_NAME } from '@/lib/duplicates-memory';

/** The "Possible duplicate" tag (by name; you may have renamed it, then nothing matches and the filter is empty). */
async function duplicateTagIds(): Promise<number[]> {
  const tags = await ipc().listTags();
  return tags.filter((t) => t.name.toLowerCase() === DUPLICATE_TAG_NAME.toLowerCase()).map((t) => t.id);
}

export async function openTarget(target: NotificationTarget): Promise<void> {
  const nav = useNavStore.getState();
  switch (target.kind) {
    case 'update': {
      const updates = useUpdateStore.getState();
      nav.closeSettings();
      if (updates.available) updates.openDialog();
      else await updates.checkNow({ auto: false });
      return;
    }
    case 'transaction':
      nav.go('transactions');
      await useTransactionsStore.getState().focusById(target.id);
      return;
    case 'transactions': {
      nav.go('transactions');
      const patch =
        target.filter === 'review'
          ? { reviewed: false }
          : target.filter === 'duplicates'
            ? { tagIds: await duplicateTagIds() }
            : { text: target.text ?? '' };
      await useTransactionsStore.getState().applyFilter({ ...clearAllPatch(), ...patch });
      return;
    }
    case 'recurring':
    case 'category':
      nav.openIntent(target);
      return;
  }
}
