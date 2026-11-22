/**
 * Clues hidden in a raw statement line ("TST* GANTRY PUBLIC HOUSE SEATTLE WA"): who processed
 * the payment, where it happened, websites, phone, store and reference numbers. Pure and local:
 * nothing here looks anything up.
 */
export interface Clue {
  label: 'Paid through' | 'Paid to' | 'Paid by' | 'Website' | 'Phone' | 'Store' | 'Reference' | 'Location';
  value: string;
}

/** Card processors that prefix the merchant name. */
const PROCESSORS: [RegExp, string][] = [
  [/^TST\*/i, 'Toast'],
  [/^SQ\s*\*/i, 'Square'],
  [/^(PAYPAL|PYPL|PP|PY)\s*\*/i, 'PayPal'],
  [/^DD\s*\*/i, 'DoorDash'],
  [/^SP\s*\*/i, 'Shopify'],
  [/^CKO\*/i, 'Checkout.com'],
  [/^WPY\*/i, 'WePay'],
  [/^IC\*/i, 'Instacart'],
  [/^FS\s*\*/i, 'FastSpring'],
  [/^EB\s*\*/i, 'Eventbrite'],
  [/^GOOGLE\s*\*/i, 'Google'],
  [/^(CLV|CLOVER)\s*\*/i, 'Clover'],
];

const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'Washington, D.C.', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/** Cities recognized even when run into the merchant name ("VIVICHICAGO"). */
const CITIES = [
  'SEATTLE', 'BELLEVUE', 'REDMOND', 'KIRKLAND', 'BOTHELL', 'WOODINVILLE', 'ISSAQUAH', 'SAMMAMISH', 'RENTON', 'KENT', 'TUKWILA',
  'BURIEN', 'SEATAC', 'FEDERAL WAY', 'AUBURN', 'TACOMA', 'PUYALLUP', 'OLYMPIA', 'LYNNWOOD', 'EDMONDS', 'EVERETT', 'SHORELINE',
  'MOUNTLAKE TERRACE', 'MERCER ISLAND', 'SNOQUALMIE', 'NORTH BEND', 'MUKILTEO', 'MARYSVILLE', 'BELLINGHAM', 'SPOKANE',
  'VANCOUVER', 'PORTLAND', 'SAN FRANCISCO', 'SAN JOSE', 'SAN DIEGO', 'LOS ANGELES', 'OAKLAND', 'SUNNYVALE', 'PALO ALTO',
  'MOUNTAIN VIEW', 'SANTA CLARA', 'CUPERTINO', 'SACRAMENTO', 'LAS VEGAS', 'PHOENIX', 'DENVER', 'SALT LAKE CITY', 'BOISE',
  'CHICAGO', 'NEW YORK', 'BROOKLYN', 'BOSTON', 'AUSTIN', 'DALLAS', 'HOUSTON', 'ATLANTA', 'MIAMI', 'ORLANDO', 'WASHINGTON',
  'ARLINGTON', 'PHILADELPHIA', 'PITTSBURGH', 'DETROIT', 'MINNEAPOLIS', 'NASHVILLE', 'CHARLOTTE', 'RALEIGH', 'HONOLULU',
  'ANCHORAGE', 'NEWARK', 'JERSEY CITY', 'WILKES-BARRE', 'SCRANTON', 'BENTONVILLE', 'MENLO PARK', 'SANTA MONICA',
];

/** Billing domains often run into other text ("YB99X95HAMZN.COM"). */
const KNOWN_SITES = ['amzn.com', 'amazon.com', 'apple.com', 'google.com', 'uber.com', 'netflix.com', 'spotify.com', 'paypal.com', 'microsoft.com', 'adobe.com', 'hulu.com', 'disneyplus.com', 'audible.com', 'openai.com', 'anthropic.com'];

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

function website(line: string): string | null {
  const m = line.match(/([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.(?:COM|NET|ORG|IO|CO))(?![A-Z0-9.])/i) ?? line.match(/([A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.(?:COM|NET|ORG|IO|CO))/i);
  if (!m) return null;
  let host = m[1].toLowerCase();
  // "help.uber.comNL": the match stops at .com; strip anything glued after it.
  // (No ".co" here: it would read ".com" as ".co" plus a glued "m".)
  host = host.replace(/\.(com|net|org|io)[a-z]+$/, '.$1');
  for (const k of KNOWN_SITES) {
    if (host === k || host.endsWith(`.${k}`)) return host;
    if (host.endsWith(k)) return k;
  }
  // A domain glued to an order code ("YB99X95H...") is not trustworthy.
  return /\d/.test(host.split('.')[0]) ? null : host;
}

/** Amex pads lines into columns: name (20), city (20), then a state or country code. */
function fixedWidth(line: string): { name: string; city: string; code: string } | null {
  const raw = line.replace(/\s+$/, '');
  if (raw.length !== 42 || !/^[A-Za-z]{2}$/.test(raw.slice(40)) || !raw.slice(20, 40).trim()) return null;
  return { name: raw.slice(0, 20), city: raw.slice(20, 40).trim(), code: raw.slice(40).toUpperCase() };
}

function location(line: string): string | null {
  const fixed = fixedWidth(line);
  if (fixed) {
    // A city column holding a number or a website says nothing about the place.
    const usable = /[A-Za-z]{3}/.test(fixed.city) && !/[./\d]/.test(fixed.city);
    if (usable) return `${titleCase(fixed.city)}, ${fixed.code}`;
    return STATES[fixed.code] ?? null;
  }
  const trimmed = line.trim();
  const tokens = trimmed.split(/\s+/);
  const state = tokens[tokens.length - 1];
  if (tokens.length < 2 || !/^[A-Z]{2}$/.test(state) || !STATES[state]) return null;
  const columns = trimmed.split(/\s{2,}/);
  if (columns.length >= 3) return `${titleCase(columns[columns.length - 2])}, ${state}`;
  const before = tokens.slice(0, -1).map((t) => t.toUpperCase());
  // Longest known city ending the text before the state, also when run into the name.
  for (const words of [3, 2, 1]) {
    if (before.length < words) continue;
    const tail = before.slice(-words).join(' ');
    const city = CITIES.filter((c) => c.split(' ').length === words).find((c) => tail === c || (words === 1 && c.length >= 5 && tail.endsWith(c)));
    if (city) return `${titleCase(city)}, ${state}`;
  }
  return STATES[state];
}

/** Wallets and point programs Amex writes before the merchant. */
const WALLETS: [RegExp, string][] = [
  [/^AplPay\s+/i, 'Apple Pay'],
  [/^GglPay\s+/i, 'Google Pay'],
  [/^PwP\s+/i, 'Pay with Points'],
];

/** A booking or order code after the star ("AIRBNB * HM8H82ZFJJ"), without a glued site name. */
function orderCode(name: string): string | null {
  const m = name.match(/\*\s*([A-Z0-9]{6,})/i);
  if (!m) return null;
  let code = m[1];
  for (const site of KNOWN_SITES) {
    const label = site.split('.')[0].toUpperCase();
    if (code.toUpperCase().endsWith(label)) code = code.slice(0, -label.length);
  }
  return code.length >= 6 && /\d/.test(code) && /[A-Z]/i.test(code) ? code : null;
}

export function statementClues(line: string): Clue[] {
  const text = line.trim();
  if (!text) return [];
  const out: Clue[] = [];

  const ach = text.match(/\bACH\s+Electronic\s+(Debit|Credit)\s+(.*)$/i);
  if (ach) {
    out.push({ label: 'Paid through', value: 'ACH bank transfer' });
    const words = ach[2].trim().split(/\s+/);
    // The other party runs up to the first payment keyword ("AMERICAN EXPR ACH PMT ...").
    const stop = words.findIndex((w) => /^(ACH|PMT|PAYMENT|PAYROLL|AUTOPAY|WEB|PPD|TRN\w*)$/i.test(w));
    const party = (stop < 0 ? words : words.slice(0, stop)).join(' ');
    if (party) out.push({ label: ach[1].toLowerCase() === 'credit' ? 'Paid by' : 'Paid to', value: titleCase(party) });
    const ref = [...words].reverse().find((w) => w.length >= 4 && /\d/.test(w) && /^[A-Z0-9-]+$/i.test(w));
    if (ref) out.push({ label: 'Reference', value: ref });
    return out;
  }

  // The merchant part: the name column of a padded line, minus any wallet prefix.
  let name = fixedWidth(line)?.name ?? text;
  const wallet = WALLETS.find(([re]) => re.test(name));
  if (wallet) name = name.replace(wallet[0], '');
  const processor = PROCESSORS.find(([re]) => re.test(name));
  const through = [wallet?.[1], processor?.[1]].filter(Boolean);
  if (through.length) out.push({ label: 'Paid through', value: through.join(', ') });

  const site = website(text);
  if (site) out.push({ label: 'Website', value: site });

  const phone = text.match(/(?<![\d])(?:1-?)?(\d{3})[-. ]?(\d{3})[-. ]?(\d{4})(?![\d])/);
  if (phone) out.push({ label: 'Phone', value: `(${phone[1]}) ${phone[2]}-${phone[3]}` });

  const store = text.match(/#\s?(\d+)/);
  if (store) out.push({ label: 'Store', value: `#${store[1]}` });

  const code = orderCode(name);
  if (code) out.push({ label: 'Reference', value: code });
  else if (!phone) {
    const ref = name.match(/(?<![\w#])(\d{6,})(?!\w)/);
    if (ref) out.push({ label: 'Reference', value: ref[1] });
  }

  const where = location(text);
  if (where) out.push({ label: 'Location', value: where });
  return out;
}
