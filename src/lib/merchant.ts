// Display names for merchants. Statement text is noisy ("SHELL OIL 58000012345",
// "SQ *BLUE BOTTLE"); this cleans it for display only. The stored merchant is
// untouched because recurring detection and learned categories are keyed on it.

/** Brands named the way people say them, matched on the start of the cleaned text. */
const BRANDS: [RegExp, string][] = [
  [/^uber ?eats\b/, 'Uber Eats'],
  [/^uber/, 'Uber'],
  [/^(amazon|amzn)/, 'Amazon'],
  [/^apple\.?com/, 'Apple'],
  [/^google youtube/, 'YouTube Premium'],
  [/^shell\b/, 'Shell'],
  [/^geico\b/, 'GEICO'],
  [/^gympass\b/, 'Gympass'],
  [/^sdot paybyphone\b|^paybyphone\b/, 'PayByPhone'],
  [/^wsdot goodtogo\b|^goodtogo\b/, 'Good To Go'],
  [/^doordash\b/, 'DoorDash'],
  [/^netflix\b/, 'Netflix'],
  [/^spotify\b/, 'Spotify'],
  [/^costco\b/, 'Costco'],
];

/** Card-processor prefixes in front of the real business name. */
const PREFIX = /^(sq|tst|dd|sp|pp|paypal)\s*\*?\s+/;

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s\-/&])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

export function cleanMerchant(raw: string): string {
  const original = raw.trim().replace(/\s+/g, ' ');
  let text = original.toLowerCase().replace(/\s*\*\s*/g, ' * ').replace(/\s+/g, ' ');
  // Processor prefix ("sq *blue bottle", "dd indnoncafebistr"), unless that is all there is.
  const stripped = text.replace(PREFIX, '').replace(/^\*\s*/, '');
  if (stripped.length > 0) text = stripped;
  text = text.replace(/\*/g, ' ');
  for (const [pattern, name] of BRANDS) if (pattern.test(text)) return name;
  // Store numbers, reference numbers and "#123" tags.
  const words = text.split(' ').filter((w) => w && !/^#\d+$/.test(w) && (w.match(/\d/g)?.length ?? 0) < 4);
  const cleaned = words.join(' ').trim();
  return titleCase(cleaned || original);
}
