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

/** Scroll the page that holds `el` so it sits near the top. Only that page moves: scrollIntoView would also scroll
 *  the app's own frame around it and leave a gap. */
function scrollPageTo(el: Element) {
  let page = el.parentElement;
  while (page && !/(auto|scroll)/.test(page.style.overflowY || getComputedStyle(page).overflowY)) page = page.parentElement;
  if (!page) return;
  page.scrollTop += el.getBoundingClientRect().top - page.getBoundingClientRect().top - 16;
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
          : target.filter === 'suggested'
            ? { suggested: true }
            : target.filter === 'duplicates'
            ? { tagIds: await duplicateTagIds() }
            : { text: target.text ?? '' };
      await useTransactionsStore.getState().applyFilter({ ...clearAllPatch(), ...patch });
      return;
    }
    case 'import':
      nav.closeSettings();
      nav.go('import');
      return;
    case 'insights':
      // Your money habits: open Insights at Tips for you once it has drawn.
      nav.closeSettings();
      nav.go('insights');
      // Insights stays mounted while hidden (inert), so wait until it's the screen showing.
      for (let i = 0; i < 40; i++) {
        const tips = document.querySelector('[aria-label="Tips for you"]');
        if (tips && !tips.closest('[inert]')) {
          // The screen re-reads its data as it appears, so the page above can still grow: scroll again once settled.
          scrollPageTo(tips);
          for (const ms of [250, 700]) setTimeout(() => scrollPageTo(tips), ms);
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    case 'recurring':
    case 'category':
      nav.openIntent(target);
      return;
  }
}
