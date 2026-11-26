import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useAnalyticsStore, watchToday } from './analytics-store';

afterEach(() => vi.useRealTimers());

describe('today', () => {
  it('moves to the new day when the app was left open past midnight, and every load uses it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50));
    useAnalyticsStore.setState({ today: '2026-10-31' });
    setIpc(createMemoryIpc());
    const stop = watchToday();
    vi.setSystemTime(new Date(2026, 10, 1, 0, 5));
    vi.advanceTimersByTime(60_000);
    expect(useAnalyticsStore.getState().today).toBe('2026-11-01');
    stop();

    vi.setSystemTime(new Date(2026, 10, 2, 9, 0));
    await useAnalyticsStore.getState().load(null);
    expect(useAnalyticsStore.getState().today).toBe('2026-11-02');
  });

  it('checks again when the window comes back to the front', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 31, 12, 0));
    useAnalyticsStore.setState({ today: '2026-10-31' });
    const stop = watchToday();
    vi.setSystemTime(new Date(2026, 10, 3, 8, 0));
    window.dispatchEvent(new Event('focus'));
    expect(useAnalyticsStore.getState().today).toBe('2026-11-03');
    stop();
  });
});
