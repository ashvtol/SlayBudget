// macOS banners and launch at login, guarded so the app runs unchanged in the browser (where Tauri is absent).

import { isTauri } from '@/lib/tauri-ipc';

export async function ensurePermission(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  return granted;
}

/**
 * Show a macOS banner. Clicking it brings SlayBudget forward and emits `notification-click` with `id` (a notification
 * id, or "bell" for a summary). Falls back to the plugin's plain banner if the native one fails.
 */
export async function sendBanner(id: string, title: string, body: string): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('notify_banner', { id, title, body });
  } catch {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification({ title, body });
  }
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

/** Open System Settings > Notifications, where you allow SlayBudget's banners. */
export async function openNotificationSettings(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_notification_settings');
}
