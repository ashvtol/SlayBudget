// npm run release -- 0.2.0
// Dates the changelog (moving Unreleased notes under the new version), bumps the version everywhere, refreshes the
// built-in exchange rates, and commits.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { bumpVersions, promoteChangelog } from './release-lib.ts';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (msg: string): never => {
  console.error(`release: ${msg}`);
  process.exit(1);
};

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) fail('usage: npm run release -- <x.y.z>');
if (git('branch', '--show-current') !== 'main') fail('run this on main.');
if (git('status', '--porcelain', '--untracked-files=no')) fail('commit or stash your changes first.');

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const paths = {
  changelog: 'CHANGELOG.md',
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  tauriConf: 'src-tauri/tauri.conf.json',
  cargoToml: 'Cargo.toml',
};
try {
  writeFileSync(paths.changelog, promoteChangelog(readFileSync(paths.changelog, 'utf8'), version, today));
  const bumped = bumpVersions(
    {
      packageJson: readFileSync(paths.packageJson, 'utf8'),
      packageLock: readFileSync(paths.packageLock, 'utf8'),
      tauriConf: readFileSync(paths.tauriConf, 'utf8'),
      cargoToml: readFileSync(paths.cargoToml, 'utf8'),
    },
    version,
  );
  writeFileSync(paths.packageJson, bumped.packageJson);
  writeFileSync(paths.packageLock, bumped.packageLock);
  writeFileSync(paths.tauriConf, bumped.tauriConf);
  writeFileSync(paths.cargoToml, bumped.cargoToml);
} catch (e) {
  fail((e as Error).message);
}

// Refresh Cargo.lock's workspace versions without touching dependencies.
try {
  execFileSync('cargo', ['update', '--workspace', '--offline'], { stdio: 'ignore' });
} catch {
  console.warn('release: could not refresh Cargo.lock offline; the next build will.');
}

// The exchange rates built into the app: the ECB's latest monthly averages (the app itself never goes online for them).
try {
  execFileSync('node', ['scripts/fx-rates.ts'], { stdio: 'inherit' });
} catch {
  console.warn('release: could not refresh the built-in exchange rates (offline?); the previous ones ship.');
}

git('add', ...Object.values(paths), 'Cargo.lock', 'crates/core/data/fx-monthly.csv');
git('commit', '-m', `release: v${version}`);
console.log(`Released v${version} on main. Next: npm run check, then npm run publish:github -- --tag`);
