/** Shared text rules for recategorizing (mirror `categorize::rules` and `merchant.rs`). */

export const MIN_CONTAINS = 3;

const PAYMENT_PLATFORMS = [
  'venmo', 'zelle', 'paypal', 'cashapp', 'cash app', 'apple cash', 'wise', 'wire transfer', 'wire from',
  'capital one transfer', 'shell oil', 'shell gas', 'exxon', 'mobil', 'bp oil', 'bp gas', 'chevron', 'texaco',
  'sunoco', 'citgo', 'marathon', 'speedway', 'valero', 'arco', 'pilot travel', 'flying j', 'loves travel',
  'kwik trip', 'sheetz', 'casey', 'circle k', 'wawa', 'quiktrip', 'racetrac', 'murphy oil', 'murphy express',
  'thorntons', 'getgo',
];

/** Lower-case, with `-`, `#`, `*` and whitespace runs turned into single spaces. */
export function normalizeDescription(s: string): string {
  return s.toLowerCase().split(/[\s\-#*]+/).filter(Boolean).join(' ');
}

export function isPaymentPlatform(merchant: string): boolean {
  const lower = merchant.toLowerCase();
  return PAYMENT_PLATFORMS.some((p) => lower.includes(p));
}
