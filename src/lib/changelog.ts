// CHANGELOG.md (Keep a Changelog) parsing, shared by the app's Update dialog and the release scripts.
// Kept free of path aliases so Node can run it directly from scripts/.

export interface ChangelogSection {
  version: string;
  date: string | null;
  /** The markdown under the version heading, trimmed. */
  body: string;
}

function parts(v: string): { nums: number[]; pre: string | null } {
  const [main, pre = null] = v.trim().replace(/^v/i, '').split('-', 2) as [string, string | undefined];
  const nums = main.split('.').map((n) => Number.parseInt(n, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return { nums, pre: pre ?? null };
}

/** Semantic version order: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (x.pre == null) return 1; // a release ranks above its prereleases
  if (y.pre == null) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

const HEADING = /^## \[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/;

/** Released versions in file order (Unreleased and the preamble are left out). */
export function parseChangelog(md: string): ChangelogSection[] {
  const out: ChangelogSection[] = [];
  let current: { version: string; date: string | null; lines: string[] } | null = null;
  const flush = () => {
    if (current && current.version.toLowerCase() !== 'unreleased') {
      out.push({ version: current.version, date: current.date, body: current.lines.join('\n').trim() });
    }
  };
  for (const line of md.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      current = { version: m[1].trim(), date: m[2] ?? null, lines: [] };
    } else if (line.startsWith('## ')) {
      flush();
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return out;
}

/** The sections after `installed` up to and including `target`, newest first. */
export function changelogBetween(md: string, installed: string, target: string): ChangelogSection[] {
  return parseChangelog(md)
    .filter((s) => compareVersions(s.version, installed) > 0 && compareVersions(s.version, target) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** One version's section, for the GitHub release body. */
export function sectionFor(md: string, version: string): ChangelogSection | null {
  return parseChangelog(md).find((s) => compareVersions(s.version, version) === 0) ?? null;
}
