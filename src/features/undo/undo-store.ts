// Undo and redo for the whole app: ⌘Z / ⇧⌘Z and the Edit menu come here. After a step, the shown screen re-reads
// its data (like ⌘R) and a short toast says what happened.
import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';

const TOAST_MS = 4000;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

interface UndoStore {
  toast: string | null;
  undo(): Promise<void>;
  redo(): Promise<void>;
  dismiss(): void;
}

export const useUndoStore = create<UndoStore>((set) => {
  const show = (toast: string) => {
    clearTimeout(hideTimer);
    set({ toast });
    hideTimer = setTimeout(() => set({ toast: null }), TOAST_MS);
  };
  const step = async (run: () => Promise<string | null>, verb: string) => {
    try {
      const label = await run();
      if (label == null) return; // nothing to undo or redo: nothing happens, as in other Mac apps
      show(`${verb} ${label}`);
      useNavStore.getState().refresh();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    toast: null,
    undo: () => step(() => ipc().undo(), 'Undid'),
    redo: () => step(() => ipc().redo(), 'Redid'),
    dismiss: () => {
      clearTimeout(hideTimer);
      set({ toast: null });
    },
  };
});
