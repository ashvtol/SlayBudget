// Which categories start out as needs. Mirrors categories::default_essential in crates/core.

const STEMS = ['rent', 'mortgage', 'housing', 'grocer', 'utilit', 'electric', 'water', 'internet', 'phone', 'insurance', 'medical', 'health', 'pharmacy', 'childcare', 'fuel', 'transit', 'loan', 'debt'];
const PHRASES = ['whole foods', 'car payment'];

/** A word beginning with one of the stems, one of the phrases, or exactly "Gas". */
export function defaultEssential(name: string): boolean {
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 1 && words[0] === 'gas') return true;
  const joined = words.join(' ');
  return words.some((w) => STEMS.some((s) => w.startsWith(s))) || PHRASES.some((p) => joined.includes(p));
}
