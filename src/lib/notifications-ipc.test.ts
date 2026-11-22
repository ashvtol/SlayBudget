import { describe, expect, it } from 'vitest';
import { createMemoryIpc } from './ipc';
import type { NewNotification, NotificationKind } from './types';

const n = (key: string, kind: NotificationKind = 'priceUp', profileId: number | null = null): NewNotification => ({
  key, kind, title: `Title ${key}`, body: 'Body', target: { kind: 'recurring', id: 1 }, profileId,
});

describe('memory IPC notifications (mirrors notifications.rs)', () => {
  it('adds each event once, even after dismissal; lists newest first; read and mark all', async () => {
    const ipc = createMemoryIpc({ profiles: [{ id: 1, name: 'Me', color: '#000', sortOrder: 0 }, { id: 2, name: 'Sam', color: '#111', sortOrder: 1 }] });
    const a = await ipc.notificationsAdd(n('a'), false);
    expect(a?.read).toBe(false);
    expect(await ipc.notificationsAdd(n('a'), false)).toBeNull();
    await ipc.notificationsAdd(n('b', 'billUpcoming', 1), false);
    await ipc.notificationsAdd(n('c', 'billUpcoming', 2), true);
    await ipc.notificationsAdd(n('update:0.2.0', 'update'), false);
    expect((await ipc.notificationsList(null)).map((x) => x.key)).toEqual(['update:0.2.0', 'c', 'b', 'a']);
    expect((await ipc.notificationsList(1)).map((x) => x.key).sort()).toEqual(['a', 'b', 'update:0.2.0']);
    await ipc.notificationsDismiss(a!.id);
    expect((await ipc.notificationsList(null)).some((x) => x.key === 'a')).toBe(false);
    expect(await ipc.notificationsAdd(n('a'), false)).toBeNull();
    await ipc.notificationsMarkAllRead(1);
    expect((await ipc.notificationsList(1)).every((x) => x.read)).toBe(true);
    expect((await ipc.notificationsList(2)).every((x) => x.read)).toBe(true); // c was a baseline item
  });

  it('pending banners exclude read items until delivered', async () => {
    const ipc = createMemoryIpc();
    const a = await ipc.notificationsAdd(n('a'), false);
    await ipc.notificationsAdd(n('b'), true);
    expect((await ipc.notificationsPending(null)).map((x) => x.key)).toEqual(['a']);
    await ipc.notificationsMarkDelivered([a!.id]);
    expect(await ipc.notificationsPending(null)).toEqual([]);
  });
});
