import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useUpdateStore, type UpdaterDeps } from './update-store';

const NOTES = `## [0.3.0] - 2027-01-10\n- Three\n\n## [0.2.0] - 2026-12-01\n- Two\n\n## [0.1.0] - 2026-11-22\n- One\n`;

function deps(over: Partial<UpdaterDeps> = {}) {
  const downloadAndInstall = vi.fn(async (onEvent?: (e: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => {
    onEvent?.({ event: 'Started', data: { contentLength: 100 } });
    onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
  });
  const d: UpdaterDeps = {
    supported: () => true,
    currentVersion: async () => '0.1.0',
    check: vi.fn(async () => ({ version: '0.3.0', body: NOTES, date: '2027-01-10', downloadAndInstall })),
    relaunch: vi.fn(async () => {}),
    ...over,
  };
  return { d, downloadAndInstall };
}

beforeEach(() => {
  setIpc(createMemoryIpc());
  useUpdateStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe('update store', () => {
  it('finds an update, opens the dialog on an automatic check, and keeps the changelog since the installed version', async () => {
    const { d } = deps();
    useUpdateStore.getState().configure(d);
    await useUpdateStore.getState().checkNow({ auto: true });
    const s = useUpdateStore.getState();
    expect(s.status).toBe('available');
    expect(s.currentVersion).toBe('0.1.0');
    expect(s.available?.version).toBe('0.3.0');
    expect(s.sections.map((x) => x.version)).toEqual(['0.3.0', '0.2.0']);
    expect(s.dialogOpen).toBe(true);
    expect(s.lastChecked).not.toBeNull();
  });

  it('Later closes the dialog, remembers the version, and the next automatic check does not reopen it', async () => {
    const { d } = deps();
    useUpdateStore.getState().configure(d);
    await useUpdateStore.getState().checkNow({ auto: true });
    await useUpdateStore.getState().later();
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(await ipc().getSetting('updates.dismissed')).toBe('0.3.0');
    await useUpdateStore.getState().checkNow({ auto: true });
    expect(useUpdateStore.getState().dialogOpen).toBe(false);
    expect(useUpdateStore.getState().status).toBe('available'); // the sidebar badge still shows
  });

  it('a manual check opens the dialog even for a dismissed version', async () => {
    await ipc().setSetting('updates.dismissed', '0.3.0');
    const { d } = deps();
    useUpdateStore.getState().configure(d);
    await useUpdateStore.getState().checkNow({ auto: false });
    expect(useUpdateStore.getState().dialogOpen).toBe(true);
  });

  it('installs with progress, then relaunches', async () => {
    const { d, downloadAndInstall } = deps();
    useUpdateStore.getState().configure(d);
    await useUpdateStore.getState().checkNow({ auto: false });
    await useUpdateStore.getState().install();
    expect(downloadAndInstall).toHaveBeenCalled();
    expect(useUpdateStore.getState().progress).toEqual({ downloaded: 40, total: 100 });
    expect(d.relaunch).toHaveBeenCalled();
  });

  it('reports up to date, errors without a popup, and does nothing outside the app', async () => {
    const up = deps({ check: vi.fn(async () => null) });
    useUpdateStore.getState().configure(up.d);
    await useUpdateStore.getState().checkNow({ auto: true });
    expect(useUpdateStore.getState().status).toBe('uptodate');

    const bad = deps({ check: vi.fn(async () => { throw new Error('offline'); }) });
    useUpdateStore.getState().configure(bad.d);
    await useUpdateStore.getState().checkNow({ auto: true });
    expect(useUpdateStore.getState()).toMatchObject({ status: 'error', error: 'offline', dialogOpen: false });

    const web = deps({ supported: () => false });
    useUpdateStore.getState().configure(web.d);
    await useUpdateStore.getState().checkNow({ auto: true });
    expect(useUpdateStore.getState().status).toBe('unsupported');
    expect(web.d.check).not.toHaveBeenCalled();
  });

  it('auto-check runs 5 seconds after launch and then every 6 hours, never in the browser', async () => {
    vi.useFakeTimers();
    const { d } = deps({ check: vi.fn(async () => null) });
    useUpdateStore.getState().configure(d);
    const stop = useUpdateStore.getState().startAutoCheck();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(d.check).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(d.check).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(6 * 3_600_000);
    expect(d.check).toHaveBeenCalledTimes(2);

    const web = deps({ supported: () => false });
    useUpdateStore.getState().configure(web.d);
    const stop2 = useUpdateStore.getState().startAutoCheck();
    await vi.advanceTimersByTimeAsync(7 * 3_600_000);
    expect(web.d.check).not.toHaveBeenCalled();
    stop2();
  });
});
