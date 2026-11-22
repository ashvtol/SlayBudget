import { describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { fetchRates, syncRates, type FetchLike } from './rates';

function mockFetch(body: unknown, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, json: async () => body }));
}

const sample = {
  base: 'USD',
  rates: {
    '2026-11-02': { INR: 83.1 },
    '2026-11-01': { INR: 83.0 },
    '2026-11-03': { INR: 0 }, // dropped (non-positive)
  },
};

describe('fetchRates', () => {
  it('parses a Frankfurter range into sorted FxRates', async () => {
    const out = await fetchRates('USD', 'INR', '2026-11-01', '2026-11-03', mockFetch(sample));
    expect(out).toEqual([
      { base: 'USD', quote: 'INR', asOf: '2026-11-01', rate: 83.0 },
      { base: 'USD', quote: 'INR', asOf: '2026-11-02', rate: 83.1 },
    ]);
  });
  it('returns nothing for same-currency and throws on HTTP error', async () => {
    expect(await fetchRates('USD', 'USD', 'a', 'b', mockFetch({}))).toEqual([]);
    await expect(fetchRates('USD', 'INR', 'a', 'b', mockFetch({}, false, 503))).rejects.toThrow('503');
  });
});

describe('syncRates', () => {
  it('persists fetched rates through the IPC', async () => {
    setIpc(createMemoryIpc());
    const n = await syncRates('USD', 'INR', '2026-11-01', '2026-11-03', mockFetch(sample));
    expect(n).toBe(2);
    expect(await ipc().fxRateOn('USD', 'INR', '2026-11-02')).toBe(83.1);
  });
});
