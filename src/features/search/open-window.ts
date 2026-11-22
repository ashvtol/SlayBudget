// Open search in a separate OS window. Uses Tauri's multi-window API in the
// desktop app; in the browser/dev it opens a normal popup window so the feature
// still works and stays testable.

import { isTauri } from '@/lib/tauri-ipc';

export async function openSearchWindow(): Promise<void> {
  if (isTauri()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const existing = await WebviewWindow.getByLabel('search');
    if (existing) {
      await existing.setFocus();
      return;
    }
    const win = new WebviewWindow('search', {
      url: 'index.html?view=search',
      title: 'Search · SlayBudget',
      width: 560,
      height: 640,
      resizable: true,
    });
    await win.once('tauri://error', (e) => console.error('search window failed', e));
    return;
  }
  // Browser/dev fallback.
  window.open(`${location.pathname}?view=search`, 'slaybudget-search', 'width=560,height=640');
}
