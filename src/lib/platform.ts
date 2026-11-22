/**
 * Platform-specific chrome. In the Mac app the window is transparent with a
 * native sidebar blur (vibrancy), so the sidebar background is see-through.
 */
export function applyPlatform(el: HTMLElement, env: { tauri: boolean; mac: boolean }): void {
  if (env.tauri && env.mac) el.dataset.vibrancy = 'on';
  else delete el.dataset.vibrancy;
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}
