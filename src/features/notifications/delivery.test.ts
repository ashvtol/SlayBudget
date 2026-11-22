import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { NewNotification } from '@/lib/types';
import { DEFAULT_CONFIG, saveConfig } from './config';
import { useInboxStore } from './inbox-store';
import { useNotificationsStore } from './notifications-store';

const n = (key: string, over: Partial<NewNotification> = {}): NewNotification => ({
  key, kind: 'billUpcoming', title: `Title ${key}`, body: `Body ${key}`, target: { kind: 'recurring', id: 1 }, profileId: null, ...over,
});
const send = vi.fn(async () => {});
let clock = new Date(2026, 10, 22, 12, 0);

beforeEach(async () => {
  setIpc(createMemoryIpc());
  send.mockClear();
  clock = new Date(2026, 10, 22, 12, 0);
  useInboxStore.setState({ items: [], open: false });
  useNotificationsStore.getState().configure({ sendBanner: send, now: () => clock });
  useNotificationsStore.setState({ enabled: true, loaded: true });
  await ipc().setSetting('notifications.baselined_at', 'x');
});
afterEach(() => vi.useRealTimers());

describe('banner delivery', () => {
  it('sends a banner per new item, marks it delivered, and skips kinds with banners off', async () => {
    await saveConfig(ipc(), { ...DEFAULT_CONFIG, kinds: { ...DEFAULT_CONFIG.kinds, priceUp: { bell: true, banner: false } } });
    const a = await ipc().notificationsAdd(n('a', { title: 'Netflix is due in 3 days' }), false);
    await ipc().notificationsAdd(n('b', { kind: 'priceUp' }), false);
    await useNotificationsStore.getState().deliverPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(String(a!.id), 'Netflix is due in 3 days', 'Body a');
    expect(await ipc().notificationsPending(null)).toEqual([]);
  });

  it('holds banners during quiet hours and sends them after', async () => {
    clock = new Date(2026, 10, 22, 23, 30);
    await ipc().notificationsAdd(n('a'), false);
    await useNotificationsStore.getState().deliverPending();
    expect(send).not.toHaveBeenCalled();
    expect(await ipc().notificationsPending(null)).toHaveLength(1);
    clock = new Date(2026, 10, 23, 8, 5);
    await useNotificationsStore.getState().deliverPending();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('more than 3 at once arrive as one summary banner that opens the bell', async () => {
    for (const k of ['a', 'b', 'c', 'd']) await ipc().notificationsAdd(n(k), false);
    await useNotificationsStore.getState().deliverPending();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('bell', '4 new alerts in SlayBudget', expect.stringContaining('Title a'));
  });

  it('with banners switched off, items still reach the bell but no banner is sent', async () => {
    useNotificationsStore.setState({ enabled: false });
    await ipc().notificationsAdd(n('a'), false);
    await useNotificationsStore.getState().checkNow();
    expect(send).not.toHaveBeenCalled();
    expect(useInboxStore.getState().items.map((x) => x.key)).toEqual(['a']);
  });

  it('checks a few seconds after launch and hourly, and retries held banners every 15 minutes', async () => {
    vi.useFakeTimers();
    const check = vi.spyOn(useNotificationsStore.getState(), 'checkNow');
    const deliver = vi.spyOn(useNotificationsStore.getState(), 'deliverPending');
    const stop = useNotificationsStore.getState().startScheduler();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(deliver.mock.calls.length).toBeGreaterThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(45 * 60_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe('clicked banners', () => {
  it('opens the item (marking it read), or the bell for a summary', async () => {
    const route = await import('./route');
    const open = vi.spyOn(route, 'openTarget').mockResolvedValue();
    const a = await ipc().notificationsAdd(n('a', { target: { kind: 'transaction', id: 9 } }), false);
    await useNotificationsStore.getState().handleClick(String(a!.id));
    expect(open).toHaveBeenCalledWith({ kind: 'transaction', id: 9 });
    expect((await ipc().notificationsList(null))[0].read).toBe(true);
    const { useNavStore } = await import('@/lib/stores/nav-store');
    useNavStore.setState({ settingsOpen: true });
    await useNotificationsStore.getState().handleClick('bell');
    expect(useInboxStore.getState().open).toBe(true);
    expect(useNavStore.getState().settingsOpen).toBe(false);
  });
});

describe('test banner', () => {
  it('sends a banner that opens the bell when clicked, even with banners off', async () => {
    useNotificationsStore.setState({ enabled: false });
    await useNotificationsStore.getState().sendTestBanner();
    expect(send).toHaveBeenCalledWith('bell', 'SlayBudget notifications work', 'Click this banner to open your notifications.');
  });
});
