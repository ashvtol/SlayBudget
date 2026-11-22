// Pure helpers for the release and publish scripts (run by Node directly, so plain erasable TypeScript only).
import { compareVersions, parseChangelog } from '../src/lib/changelog.ts';

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Make sure CHANGELOG.md has a dated section for `version`: keep one that exists, otherwise move the
 * Unreleased notes under `## [version] - today`. Throws when there's nothing to release.
 */
export function promoteChangelog(md: string, version: string, today: string): string {
  if (parseChangelog(md).some((s) => s.version === version && s.date)) return md;
  const lines = md.split('\n');
  const start = lines.findIndex((l) => /^## \[Unreleased\]\s*$/i.test(l));
  if (start === -1) throw new Error(`No changelog section for ${version} and no Unreleased section.`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const notes = lines.slice(start + 1, end).join('\n').trim();
  if (!notes) throw new Error(`No changelog notes for ${version}: add them under ## [Unreleased] first.`);
  return [...lines.slice(0, start), '## [Unreleased]', '', `## [${version}] - ${today}`, notes, '', ...lines.slice(end)].join('\n');
}

export interface VersionFiles {
  packageJson: string;
  packageLock: string;
  tauriConf: string;
  cargoToml: string;
}

/** Set the app version in package.json, package-lock.json, tauri.conf.json and the workspace Cargo.toml. */
export function bumpVersions(files: VersionFiles, version: string): VersionFiles {
  if (!SEMVER.test(version)) throw new Error(`Version must look like x.y.z, got "${version}".`);
  const current = JSON.parse(files.packageJson).version as string;
  if (compareVersions(version, current) <= 0) throw new Error(`${version} must be newer than the current ${current}.`);
  const setTop = (json: string) => json.replace(/^(\s*"version":\s*")[^"]+(")/m, `$1${version}$2`);
  const lock = JSON.parse(files.packageLock);
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  return {
    packageJson: setTop(files.packageJson),
    packageLock: `${JSON.stringify(lock, null, 2)}\n`,
    tauriConf: setTop(files.tauriConf),
    cargoToml: files.cargoToml.replace(/(\[workspace\.package\][^[]*?\nversion\s*=\s*")[^"]+(")/, `$1${version}$2`),
  };
}

/** Folders and files that stay private: working notes, internal specs, launch drafts, local config. */
const PRIVATE = ['tasks/', 'docs/superpowers/', 'docs/launch/', '.claude/', '.publish-blocklist'];

export function isPublished(path: string): boolean {
  return !PRIVATE.some((p) => path === p || path.startsWith(p));
}

/** One case-insensitive pattern per line; blank lines and # comments are ignored. */
export function parseBlocklist(text: string): RegExp[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'i'));
}

export function findBlocked(files: { path: string; content: string }[], patterns: RegExp[]): { path: string; pattern: string }[] {
  const hits: { path: string; pattern: string }[] = [];
  for (const f of files) for (const p of patterns) if (p.test(f.content) || p.test(f.path)) hits.push({ path: f.path, pattern: p.source });
  return hits;
}

/** What `npm run release:approve` records after a local rehearsal: this version, at this commit, was tested. */
export function approvalFor(version: string, commit: string, at: string): string {
  return `${JSON.stringify({ version, commit, at }, null, 2)}\n`;
}

/** Null when `version` at `commit` was rehearsed and approved; otherwise why publishing with a tag must wait. */
export function checkApproval(marker: string | null, version: string, commit: string): string | null {
  const redo = 'Run npm run release:rehearse, test the app, then npm run release:approve.';
  let saved: { version?: string; commit?: string } | null = null;
  try {
    saved = marker ? JSON.parse(marker) : null;
  } catch {
    saved = null;
  }
  if (!saved?.version || !saved.commit) return `No tested release on record. ${redo}`;
  if (saved.version !== version) return `v${version} hasn't been tested (the last approval was v${saved.version}). ${redo}`;
  if (saved.commit !== commit) return `The code changed since v${version} was tested. ${redo}`;
  return null;
}

/** What a rehearsal leaves in the repo: its single-use records and its release build folders (rebuilt each time). */
export const REHEARSAL_LEFTOVERS = [
  '.release-rehearsal.json',
  '.release-approved.json',
  'target/aarch64-apple-darwin',
  'target/x86_64-apple-darwin',
  'target/universal-apple-darwin',
];

const REHEARSAL_BACKUP = /^slaybudget\.before-rehearsal-.+-(\d{8}T\d{6})\.db$/;

/** Rehearsal database backups to delete: all but the newest. Other backups and the database itself are never listed. */
export function rehearsalBackupsToDelete(files: string[]): string[] {
  const backups = files
    .map((f) => ({ f, stamp: REHEARSAL_BACKUP.exec(f)?.[1] }))
    .filter((x): x is { f: string; stamp: string } => x.stamp != null)
    .sort((a, b) => a.stamp.localeCompare(b.stamp));
  return backups.slice(0, -1).map((x) => x.f);
}
