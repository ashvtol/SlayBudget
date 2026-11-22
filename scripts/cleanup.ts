// npm run release:cleanup  (also runs after a successful `npm run publish:github -- --tag`)
// Removes what a release rehearsal leaves behind: its build folders, its single-use records, and all but the newest
// rehearsal database backup. Your database and every other backup are left alone.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REHEARSAL_LEFTOVERS, rehearsalBackupsToDelete } from './release-lib.ts';

export function cleanupRehearsal(): string[] {
  const removed: string[] = [];
  for (const path of REHEARSAL_LEFTOVERS) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    }
  }
  const data = join(homedir(), 'Library', 'Application Support', 'dev.ashvtol.slaybudget');
  if (existsSync(data)) {
    for (const f of rehearsalBackupsToDelete(readdirSync(data))) {
      rmSync(join(data, f), { force: true });
      removed.push(join(data, f));
    }
  }
  return removed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const removed = cleanupRehearsal();
  console.log(removed.length ? `cleanup: removed\n  ${removed.join('\n  ')}` : 'cleanup: nothing to remove');
}
