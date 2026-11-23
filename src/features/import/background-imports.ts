// Background imports: statements that appear in the watched folder (and Downloads, if you turned that on) go through
// the same import as a file you drop in: recognized ones import on their own, ones that need an account wait on the
// Import page. The bell says which. Files are only read, never moved or changed.
import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { loadConfig } from '@/lib/notification-config';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { AccountChoice, NeedsAccount, NewNotification } from '@/lib/types';
import { createDefaultImportDeps } from './default-deps';
import { classifyFile, importOne, type FileResult, type ImportDeps } from './run-imports';

/** How often to look for new files while the app is open. */
export const SCAN_EVERY_MS = 2 * 60_000;

export interface WaitingFile {
  path: string;
  name: string;
  modifiedMs: number;
  needs: NeedsAccount;
}

interface BackgroundImports {
  /** Found files that need an account. */
  waiting: WaitingFile[];
  /** Files already looked at this session (path: modified time), so unchanged ones aren't read again. */
  seen: Record<string, number>;
  scan(): Promise<void>;
  answer(path: string, choice: AccountChoice): Promise<FileResult | null>;
  skip(path: string): void;
  /** Called after anything was imported (the app reloads what it shows). */
  onImported?: () => void;
}

const deps = (): ImportDeps => ({ ...createDefaultImportDeps(), ipc: ipc() });
const profileId = () => {
  const { activeProfileId, profiles } = useProfileStore.getState();
  return activeProfileId ?? profiles[0]?.id ?? null;
};

async function readFile(path: string, name: string): Promise<File> {
  return new File([await ipc().readStatement(path)], name);
}

async function notify(n: Omit<NewNotification, 'kind' | 'profileId'>) {
  const config = await loadConfig(ipc());
  if (!config.kinds.statements?.bell) return;
  await ipc().notificationsAdd({ ...n, kind: 'statements', profileId: null }, false);
}

const count = (n: number) => `${n} ${n === 1 ? 'transaction' : 'transactions'}`;

export const useBackgroundImports = create<BackgroundImports>((set, get) => ({
  waiting: [],
  seen: {},

  async scan() {
    const profile = profileId();
    if (profile == null) return;
    let found;
    try {
      found = await ipc().statementCandidates();
    } catch {
      return; // no watched folder or Downloads to look in
    }
    let imported = false;
    for (const c of found) {
      if (get().seen[c.path] === c.modifiedMs || classifyFile(c.name) === 'unsupported') continue;
      set((s) => ({ seen: { ...s.seen, [c.path]: c.modifiedMs } }));
      let result: FileResult;
      try {
        result = await importOne(await readFile(c.path, c.name), profile, deps(), undefined, c.path);
      } catch {
        continue;
      }
      const report = result.report;
      if (!report || result.error) continue; // not a statement (or unreadable): left alone
      if (report.needsAccount) {
        const needs = report.needsAccount;
        set((s) => ({ waiting: [...s.waiting.filter((w) => w.path !== c.path), { path: c.path, name: c.name, modifiedMs: c.modifiedMs, needs }] }));
        await notify({
          key: `statement-waiting:${c.path}:${c.modifiedMs}`,
          title: `${c.name} needs an account`,
          body: 'Tell SlayBudget which account this statement is, and it imports it.',
          target: { kind: 'import' },
        });
      } else if (!report.alreadyImported && report.inserted > 0) {
        imported = true;
        await notify({
          key: `statement-imported:${c.path}:${c.modifiedMs}`,
          title: `Imported ${count(report.inserted)} from ${c.name} into ${report.sourceName}`,
          body: report.duplicates > 0 ? `${report.duplicates} were already there.` : 'From a statement SlayBudget found for you.',
          target: { kind: 'import' },
        });
      }
    }
    if (imported) get().onImported?.();
  },

  async answer(path, choice) {
    const file = get().waiting.find((w) => w.path === path);
    const profile = profileId();
    if (!file || profile == null) return null;
    const result = await importOne(await readFile(path, file.name), profile, deps(), choice, path);
    if (!result.error) set((s) => ({ waiting: s.waiting.filter((w) => w.path !== path) }));
    get().onImported?.();
    return result;
  },

  skip(path) {
    set((s) => ({ waiting: s.waiting.filter((w) => w.path !== path) }));
  },
}));
