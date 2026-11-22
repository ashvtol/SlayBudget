// Thin wrappers over the Tauri notification and autostart plugins, guarded so
// the app runs unchanged in the browser/dev (where the plugins are absent).

import { isTauri } from '@/lib/tauri-ipc';

export async function ensurePermission(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  return granted;
}

export async function notify(title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  const { sendNotification } = await import('@tauri-apps/plugin-notification');
  sendNotification({ title, body });
}

export async function isAutostartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

export async function setAutostart(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const mod = await import('@tauri-apps/plugin-autostart');
  if (enabled) await mod.enable();
  else await mod.disable();
}
