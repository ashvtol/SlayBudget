// macOS banners and launch at login, guarded so the app runs unchanged in the browser (where Tauri is absent).

import { isTauri } from '@/lib/tauri-ipc';

/**
 * What macOS does with SlayBudget's banners: shows them ("allowed"), only puts them in Notification Center ("quiet",
 * alert style None), blocks them ("denied"), hasn't been asked ("notAsked"), or can't tell ("unknown": the browser, a
 * development build, or another platform).
 */
export type BannerPermission = 'allowed' | 'quiet' | 'denied' | 'notAsked' | 'unknown';

export async function bannerPermission(): Promise<BannerPermission> {
  if (!isTauri()) return 'unknown';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<BannerPermission>('notification_permission').catch(() => 'unknown' as const);
}

/** Ask macOS to allow banners (it prompts once); returns what it allows now. */
export async function requestBannerPermission(): Promise<BannerPermission> {
  if (!isTauri()) return 'unknown';
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<BannerPermission>('request_notification_permission').catch(() => 'unknown' as const);
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
