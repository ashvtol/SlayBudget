// npm run release:rehearse
// Builds the release app exactly as GitHub will (release config, signed updater files, DMG), checks it, backs up your
// database, then prints what to review in the development window (npm run tauri dev). It never touches your installed
// app: you update that yourself through the in-app updater. Approve with npm run release:approve.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { sectionFor } from '../src/lib/changelog.ts';

const PENDING = '.release-rehearsal.json';
const KEY = join(homedir(), '.tauri', 'slaybudget.key');
const DATA = join(homedir(), 'Library', 'Application Support', 'dev.ashvtol.slaybudget');

const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
const fail = (msg: string): never => {
  console.error(`rehearse: ${msg}`);
  process.exit(1);
};
const step = (msg: string) => console.log(`\n▸ ${msg}`);

if (run('git', ['branch', '--show-current']) !== 'main') fail('run this on main, after npm run release -- <version>.');
if (run('git', ['status', '--porcelain', '--untracked-files=no'])) fail('commit or stash your changes first.');
if (!existsSync(KEY)) fail(`the updater signing key isn't at ${KEY}.`);
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const commit = run('git', ['rev-parse', 'HEAD']);

// Universal like GitHub's build when the Intel target is installed; otherwise this Mac's architecture.
const targets = run('rustup', ['target', 'list', '--installed']).split('\n');
const universal = targets.includes('x86_64-apple-darwin') && targets.includes('aarch64-apple-darwin');
const target = universal ? 'universal-apple-darwin' : 'aarch64-apple-darwin';
if (!universal) console.log('rehearse: building for Apple Silicon only (for universal: rustup target add x86_64-apple-darwin).');

step(`Building SlayBudget ${version} for ${target} (release config, signed update files, DMG)`);
const build = spawnSync(
  'npx',
  ['tauri', 'build', '--target', target, '--bundles', 'app,dmg', '--config', 'src-tauri/tauri.release.conf.json'],
  { stdio: 'inherit', env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(KEY, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' } },
);
if (build.status !== 0) fail('the build failed (see above).');

const bundle = join('target', target, 'release', 'bundle');
const built = join(bundle, 'macos', 'SlayBudget.app');
const dmg = readdirSync(join(bundle, 'dmg')).find((f) => f.endsWith('.dmg'));

step('Checking the build');
const plistVersion = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(built, 'Contents', 'Info.plist')]);
if (plistVersion !== version) fail(`the app says ${plistVersion}, expected ${version}.`);
run('codesign', ['--verify', '--deep', built]);
const archs = run('lipo', ['-archs', join(built, 'Contents', 'MacOS', 'slaybudget')]);
if (!existsSync(join(bundle, 'macos', 'SlayBudget.app.tar.gz.sig'))) fail('the signed update file is missing.');
if (!dmg) fail('the DMG is missing.');
console.log(`  version ${plistVersion} · signature ok · ${archs} · update file signed · ${dmg}`);

step('Backing up your database');
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
const backup = join(DATA, `slaybudget.before-rehearsal-${version}-${stamp}.db`);
run('sqlite3', [join(DATA, 'slaybudget.db'), `.backup '${backup}'`]);
console.log(`  ${backup}`);


writeFileSync(PENDING, `${JSON.stringify({ version, commit }, null, 2)}\n`);

const notes = sectionFor(readFileSync('CHANGELOG.md', 'utf8'), version)?.body ?? '(no changelog section found)';
console.log(`
Your installed SlayBudget was not touched: update it yourself from the app once ${version} is published.
Review ${version} in the development window (npm run tauri dev: the real app on your data, nothing installed):
  [ ] Your data is all there: Dashboard, Transactions, Categories, Recurrings, Cash flow, Insights
  [ ] An import still works (Import, or your watched folder)
  [ ] README.md describes what's new (features table, FAQ, screenshots from sample data)
  [ ] What's new in this release works:
${notes.split('\n').map((l) => `      ${l}`).join('\n')}

When it all works:   npm run release:approve
Then publish:        npm run publish:github -- --tag
The DMG to try on another Mac: ${join(bundle, 'dmg', dmg)}
`);
