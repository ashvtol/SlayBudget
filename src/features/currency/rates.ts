// Fetch daily FX rates from Frankfurter (api.frankfurter.app) — a free, keyless
// ECB-backed source — and persist them. The fetcher is injectable so it tests
// without network. In the desktop app the webview performs the request.

import { ipc } from '@/lib/ipc';
import type { FxRate } from '@/lib/types';

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface FrankfurterRange {
  base?: string;
  rates?: Record<string, Record<string, number>>;
}

const HOST = 'https://api.frankfurter.app';

/** Fetch daily `base`→`quote` rates for an inclusive [from, to] date range. */
export async function fetchRates(
  base: string,
  quote: string,
  from: string,
  to: string,
  fetchFn: FetchLike,
): Promise<FxRate[]> {
  if (base === quote) return [];
  const url = `${HOST}/${from}..${to}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`rate fetch failed: ${res.status}`);
  const body = (await res.json()) as FrankfurterRange;
  const rates = body.rates ?? {};
  const out: FxRate[] = [];
  for (const [asOf, byQuote] of Object.entries(rates)) {
    const rate = byQuote[quote];
    if (typeof rate === 'number' && rate > 0) out.push({ base, quote, asOf, rate });
  }
  return out.sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/** Fetch and persist rates; returns the number stored. */
export async function syncRates(
  base: string,
  quote: string,
  from: string,
  to: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<number> {
  const rates = await fetchRates(base, quote, from, to, fetchFn);
  if (rates.length === 0) return 0;
  return ipc().fxUpsertMany(rates);
}
