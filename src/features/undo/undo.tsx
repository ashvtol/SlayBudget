import { useEffect } from 'react';
import { isTauri } from '@/lib/tauri-ipc';
import { useUndoStore } from './undo-store';

/** Typing in a field: ⌘Z belongs to the field (its own text undo), as everywhere on macOS. */
function typingIn(el: Element | null): boolean {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.isContentEditable);
}

/** One ⌘Z may reach both the page and the Edit menu: the menu skips a step the keyboard just took. */
const SAME_PRESS_MS = 400;
let keyedAt = -Infinity;

/** What the Edit menu's Undo or Redo does (also for its shortcut when the page didn't take it). */
export function menuStep(which: 'undo' | 'redo', now = performance.now()) {
  if (typingIn(document.activeElement)) {
    document.execCommand(which);
    return;
  }
  if (now - keyedAt < SAME_PRESS_MS) return;
  void useUndoStore.getState()[which]();
}

/** ⌘Z undo and ⇧⌘Z redo, from the keyboard and from the Edit menu. */
export function useUndoKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (typingIn(e.target as Element)) return;
      e.preventDefault();
      keyedAt = performance.now();
      void (e.shiftKey ? useUndoStore.getState().redo() : useUndoStore.getState().undo());
    };
    window.addEventListener('keydown', onKey);
    // The Edit menu's Undo and Redo: in a field they undo typing, elsewhere your last change.
    const stops: (() => void)[] = [];
    if (isTauri()) {
      void import('@tauri-apps/api/event').then(({ listen }) => {
        for (const [event, which] of [['menu-undo', 'undo'], ['menu-redo', 'redo']] as const) {
          void listen(event, () => menuStep(which)).then((stop) => stops.push(stop));
        }
      });
    }
    return () => {
      window.removeEventListener('keydown', onKey);
      for (const stop of stops) stop();
    };
  }, []);
}

/** "Undid Change Category", briefly, at the bottom of the window. */
export function UndoToast() {
  const toast = useUndoStore((s) => s.toast);
  const dismiss = useUndoStore((s) => s.dismiss);
  if (!toast) return null;
  return (
    <div
      role="status"
      onClick={dismiss}
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-[13px] font-medium shadow-2xl"
      style={{ background: 'var(--panel)', borderColor: 'var(--line-strong)', color: 'var(--text)' }}
    >
      {toast}
    </div>
  );
}
