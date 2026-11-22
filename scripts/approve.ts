// npm run release:approve
// Records that the rehearsed build (this version, at this commit) was tested on this Mac; publishing a tag needs it.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { approvalFor, checkApproval } from './release-lib.ts';

const PENDING = '.release-rehearsal.json';
const APPROVED = '.release-approved.json';
const fail = (msg: string): never => {
  console.error(`approve: ${msg}`);
  process.exit(1);
};

const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// The rehearsal must be of exactly this version and commit.
const problem = checkApproval(existsSync(PENDING) ? readFileSync(PENDING, 'utf8') : null, version, commit);
if (problem) fail(problem.replace('test the app, then npm run release:approve', 'test the app, then approve'));
writeFileSync(APPROVED, approvalFor(version, commit, new Date().toISOString()));
console.log(`approve: v${version} (${commit.slice(0, 7)}) is approved. Next: npm run publish:github -- --tag`);
