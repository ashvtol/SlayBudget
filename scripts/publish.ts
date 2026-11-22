// npm run publish:github [-- --tag]
// Copies main's tree (minus private folders) onto the local `public` branch as one commit with the GitHub noreply
// author, refuses if any file matches a pattern in the git-ignored .publish-blocklist, pushes it to the public repo's
// main, and with --tag also pushes v<package.json version>, which starts the release build.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { checkApproval, isPublished, parseBlocklist } from './release-lib.ts';

const REMOTE = 'git@github.com:ashvtol/SlayBudget.git';
const AUTHOR = { name: 'ashvtol', email: 'ashvtol@users.noreply.github.com' };
const INDEX = '.git/publish-index';

const git = (args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
const fail = (msg: string): never => {
  console.error(`publish: ${msg}`);
  process.exit(1);
};

const tag = process.argv.includes('--tag');
if (git(['branch', '--show-current']) !== 'main') fail('run this on main.');
if (git(['status', '--porcelain', '--untracked-files=no'])) fail('commit or stash your changes first.');
if (!existsSync('.publish-blocklist')) fail('create .publish-blocklist (one pattern per line: your name, email, ...).');
const patterns = parseBlocklist(readFileSync('.publish-blocklist', 'utf8'));
if (patterns.length === 0) fail('.publish-blocklist has no patterns.');

// Build the public tree in a scratch index so the working tree is untouched.
const idx = { GIT_INDEX_FILE: INDEX };
let tree: string;
try {
  git(['read-tree', 'HEAD'], idx);
  const drop = git(['ls-files'], idx).split('\n').filter((p) => p && !isPublished(p));
  for (let i = 0; i < drop.length; i += 200) git(['rm', '--cached', '-q', '--', ...drop.slice(i, i + 200)], idx);
  tree = git(['write-tree'], idx);
} finally {
  rmSync(INDEX, { force: true });
}

const blocked: string[] = [];
for (const p of patterns) {
  try {
    blocked.push(...git(['grep', '-I', '-i', '-l', '-E', p.source, tree]).split('\n').filter(Boolean).map((l) => `${l.split(':').slice(1).join(':')}  (${p.source})`));
  } catch {
    // git grep exits 1 when nothing matches
  }
  for (const f of git(['ls-tree', '-r', '--name-only', tree]).split('\n')) if (p.test(f)) blocked.push(`${f}  (name matches ${p.source})`);
}
if (blocked.length) fail(`refusing to publish; these match .publish-blocklist:\n  ${blocked.join('\n  ')}`);

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
// A release goes out only after the same version and commit was built, installed and tested here.
if (tag) {
  const approval = existsSync('.release-approved.json') ? readFileSync('.release-approved.json', 'utf8') : null;
  const problem = checkApproval(approval, version, git(['rev-parse', 'HEAD']));
  if (problem) fail(`refusing to tag v${version}: ${problem}`);
}
const parent = git(['rev-parse', '--verify', '-q', 'refs/heads/public']);
const parentTree = parent ? git(['rev-parse', `${parent}^{tree}`]) : '';
let commit = parent;
if (tree !== parentTree) {
  const head = git(['log', '-1', '--format=%s']);
  const env = { GIT_AUTHOR_NAME: AUTHOR.name, GIT_AUTHOR_EMAIL: AUTHOR.email, GIT_COMMITTER_NAME: AUTHOR.name, GIT_COMMITTER_EMAIL: AUTHOR.email };
  commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', tag ? `Release v${version}` : head], env);
  git(['update-ref', 'refs/heads/public', commit]);
  console.log(`publish: new public commit ${commit.slice(0, 7)}`);
} else {
  console.log('publish: public tree already up to date');
}

git(['push', REMOTE, 'refs/heads/public:refs/heads/main']);
if (tag) {
  const name = `v${version}`;
  git(['tag', '-a', name, commit, '-m', `SlayBudget ${name}`]);
  git(['push', REMOTE, `refs/tags/${name}`]);
  console.log(`publish: pushed ${name}; the release workflow is building the DMG (draft release).`);
}
