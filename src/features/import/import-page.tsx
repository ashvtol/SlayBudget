import { useEffect, useRef, useState } from 'react';
import { Page } from '@/app/shell/page';
import { useProfileStore } from '@/lib/stores/profile-store';
import { createDefaultImportDeps } from './default-deps';
import { RecentImports } from './recent-imports';
import { DUPLICATE_TAG_COLOR } from '@/lib/duplicates-memory';
import { openTarget } from '@/features/notifications/route';
import type { AccountChoice, ImportReport, Source, Tag } from '@/lib/types';
import { WhichAccount } from './which-account';
import { FolderGuide } from './folder-guide';
import { useBackgroundImports } from './background-imports';
import { answerGroup, importOne, runImports, summarize, type FileResult, type ImportDeps } from './run-imports';
import { groupChoice, groupWaiting, type WaitingGroup } from './group-waiting';
import { Button } from '@/components/button';

/** "Amex Gold · 17 added · 298 already imported · 3 to check" */
function fileLine(r: FileResult): string {
  if (r.error) return r.error;
  if (r.skipped) return 'skipped';
  const report = r.report as ImportReport;
  if (report.needsAccount) return 'needs an account';
  if (report.alreadyImported) return `${report.inserted} added (already imported)`;
  return reportLine(report);
}
function reportLine(r: ImportReport): string {
  const parts = [r.sourceName ? `${r.sourceName} · ${r.inserted} added` : `${r.inserted} added`];
  if (r.duplicates > 0) parts.push(`${r.duplicates} already imported`);
  const flags = r.flags?.length ?? 0;
  if (flags > 0) parts.push(`${flags} to check`);
  return parts.join(' · ');
}

/** "Which account is Chase ending 7781?"; one file keeps its name; a group without a number asks about "these". */
function groupTitle(g: WaitingGroup): string {
  if (g.items.length === 1) return `Which account is ${g.items[0].name}?`;
  if (g.clueless) return 'Which account are these statements?';
  const { bank, last4 } = g.needs.clues;
  return `Which account is ${bank ? `${bank} ending` : 'the account ending'} ${last4}?`;
}

/** The heads-up list of rows that look like ones you already had. Nothing to do now: they're tagged for later. */
function PossibleDuplicates({ results }: { results: FileResult[] }) {
  const flags = results.flatMap((r) => r.report?.flags ?? []);
  if (flags.length === 0) return null;
  const title = flags.length === 1 ? '1 possible duplicate to check' : `${flags.length} possible duplicates to check`;
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--line)' }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 flex items-center gap-2 text-[13px] font-semibold">
          <span className="h-2 w-2 rounded-full" style={{ background: DUPLICATE_TAG_COLOR }} />
          {title}
        </h3>
        <Button variant="plain" onClick={() => void openTarget({ kind: 'transactions', filter: 'duplicates' })}>
          Review in Transactions
        </Button>
      </div>
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        They are tagged Possible duplicate and marked to review. Nothing was removed; check them whenever you like.
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12px]">
        {flags.map((f) => (
          <li key={f.id} className="flex gap-2">
            <span className="shrink-0 font-semibold" style={{ color: f.confidence === 'certain' ? 'var(--neg)' : DUPLICATE_TAG_COLOR }}>
              {f.confidence === 'certain' ? 'Very likely' : 'Maybe'}
            </span>
            <span>{f.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Status = { phase: 'idle' } | { phase: 'running'; done: number; total: number; current: string } | { phase: 'done'; results: FileResult[] };

/** Import screen: drop zone, file/folder pickers, progress and a results summary. */
export function ImportPage({ deps = createDefaultImportDeps(), onImported }: { deps?: ImportDeps; onImported?: () => void }) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfileId = useProfileStore((s) => s.activeProfileId);
  const targetProfileId = activeProfileId ?? profiles[0]?.id ?? null;

  const [status, setStatus] = useState<Status>({ phase: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [importsVersion, setImportsVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  async function handleFiles(files: File[]) {
    if (files.length === 0 || targetProfileId == null) return;
    setStatus({ phase: 'running', done: 0, total: files.length, current: files[0].name });
    const results = await runImports(files, targetProfileId, deps, (done, total, current) =>
      setStatus({ phase: 'running', done, total, current }),
    );
    setStatus({ phase: 'done', results });
    setImportsVersion((v) => v + 1);
    onImported?.();
  }

  const summary = status.phase === 'done' ? summarize(status.results) : null;

  // Files that need an account: your accounts and tags, to choose from.
  const [accounts, setAccounts] = useState<Source[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const found = useBackgroundImports((s) => s.waiting);
  const answerFound = useBackgroundImports((s) => s.answerMany);
  const skipFound = useBackgroundImports((s) => s.skipMany);
  const waiting = (summary?.waiting ?? 0) + found.length;
  useEffect(() => {
    if (!waiting) return;
    void Promise.resolve()
      .then(() => deps.ipc.listSources())
      .then((all) => setAccounts(all.filter((a) => a.profileId === targetProfileId)))
      .catch(() => setAccounts([]));
    void Promise.resolve()
      .then(() => deps.ipc.listTags())
      .then(setTags)
      .catch(() => setTags([]));
  }, [waiting, deps, targetProfileId]);

  const results = status.phase === 'done' ? status.results : [];
  const isWaiting = (r: FileResult) => !!r.report?.needsAccount && !r.skipped && !r.error;
  const resultGroups = groupWaiting(
    results.flatMap((r, i) => (isWaiting(r) ? [{ id: String(i), name: r.name, needs: r.report!.needsAccount! }] : [])),
  );
  const foundGroups = groupWaiting(found.map((f) => ({ id: f.path, name: f.name, needs: f.needs })));

  /** Put new results in place, by index, on the latest list. */
  const update = (changes: Map<number, FileResult>) =>
    setStatus((s) => (s.phase === 'done' ? { phase: 'done', results: s.results.map((r, i) => changes.get(i) ?? r) } : s));

  /** Import the chosen files of a group; when remembered, check the other waiting files again. */
  async function answer(ids: string[], choice: AccountChoice, current: FileResult[]) {
    if (targetProfileId == null) return current;
    const files = ids.flatMap((id) => (current[Number(id)]?.file ? [{ id, file: current[Number(id)].file! }] : []));
    const done = await answerGroup(files, targetProfileId, deps, choice);
    const changes = new Map([...done].map(([id, r]) => [Number(id), r]));
    if (choice.remember) {
      for (const [i, r] of current.entries()) {
        if (changes.has(i) || !isWaiting(r) || !r.file) continue;
        const again = await importOne(r.file, targetProfileId, deps);
        if (!again.error && !again.report?.needsAccount) changes.set(i, again);
      }
    }
    update(changes);
    setImportsVersion((v) => v + 1);
    onImported?.();
    return current.map((r, i) => changes.get(i) ?? r);
  }
  const skip = (ids: string[]) => update(new Map(ids.map((id) => [Number(id), { ...results[Number(id)], skipped: true }])));

  const [importingAll, setImportingAll] = useState(false);
  async function importAll() {
    setImportingAll(true);
    try {
      await importEach();
    } finally {
      setImportingAll(false);
      setImportsVersion((v) => v + 1);
    }
  }
  async function importEach() {
    let current = results;
    for (const g of resultGroups) {
      const choice = groupChoice(g);
      // A group the last answer already imported (it was recognized) is passed over.
      const ids = g.items.map((i) => i.id).filter((id) => isWaiting(current[Number(id)]));
      if (choice && ids.length) current = await answer(ids, choice, current);
    }
    for (const g of foundGroups) {
      const choice = groupChoice(g);
      if (choice) await answerFound(g.items.map((i) => i.id), choice);
    }
    onImported?.();
  }
  function skipAll() {
    skip(resultGroups.flatMap((g) => g.items.map((i) => i.id)));
    skipFound(foundGroups.flatMap((g) => g.items.map((i) => i.id)));
  }
  const waitingFiles = [...resultGroups, ...foundGroups].reduce((n, g) => n + g.items.length, 0);
  const noGuess = [...resultGroups, ...foundGroups].find((g) => !groupChoice(g));

  const card = (g: WaitingGroup, onAnswer: (choice: AccountChoice, ids: string[]) => void, onSkip: (ids: string[]) => void) => {
    const idOf = new Map(g.items.map((i) => [i.name, i.id]));
    return (
      <WhichAccount
        key={g.key + g.items.map((i) => i.id).join()}
        title={groupTitle(g)}
        fileNames={g.items.map((i) => i.name)}
        selectable={g.clueless && g.items.length > 1}
        needs={g.needs}
        accounts={accounts}
        tags={tags}
        onAnswer={(choice, chosen) => onAnswer(choice, chosen.map((n) => idOf.get(n)!))}
        onSkip={() => onSkip(g.items.map((i) => i.id))}
      />
    );
  };

  return (
    <Page title="Import" subtitle={targetProfileId == null ? 'Create a profile first' : undefined}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles([...e.dataTransfer.files]);
        }}
        className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center"
        style={{ borderColor: dragging ? 'var(--accent)' : 'var(--line)', background: dragging ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent' }}
      >
        <p className="m-0 text-sm" style={{ color: 'var(--muted)' }}>
          Drop CSV, PDF, OFX, QFX, QBO or QIF statements here, or
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} className="min-h-11 rounded-lg border px-4 text-sm font-medium" style={{ borderColor: 'var(--line)', color: 'var(--text)' }}>
            Choose files
          </button>
          <button type="button" onClick={() => folderInput.current?.click()} className="min-h-11 rounded-lg border px-4 text-sm font-medium" style={{ borderColor: 'var(--line)', color: 'var(--text)' }}>
            Choose folder
          </button>
        </div>
        <input ref={fileInput} type="file" multiple accept=".csv,.tsv,.pdf,.ofx,.qfx,.qbo,.qif" aria-label="Choose files" className="hidden" onChange={(e) => void handleFiles([...(e.target.files ?? [])])} />
        <input
          ref={folderInput}
          type="file"
          aria-label="Choose folder"
          className="hidden"
          onChange={(e) => void handleFiles([...(e.target.files ?? [])])}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
      </div>

      {status.phase === 'running' && (
        <div role="status" className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span>Importing {status.current}</span>
            <span className="tabular-nums">{status.done} / {status.total}</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: 'var(--track)' }}>
            <div className="h-2 rounded-full" style={{ width: `${(status.done / status.total) * 100}%`, background: 'var(--accent)' }} />
          </div>
        </div>
      )}

      <FolderGuide />
      {waitingFiles > 1 && (
        <section aria-label={`${waitingFiles} statements need an account`} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <span className="text-[13px] font-semibold">{`${waitingFiles} statements need an account`}</span>
          <div className="flex gap-2">
            <Button onClick={skipAll} disabled={importingAll}>Skip all</Button>
            <Button
              variant="primary"
              disabled={!!noGuess || importingAll}
              title={noGuess ? `Name an account for ${noGuess.label} first` : 'Import each into its likely account, or a new one'}
              onClick={() => void importAll()}
            >
              {importingAll ? 'Importing…' : 'Import all'}
            </Button>
          </div>
        </section>
      )}
      {found.length > 0 && (
        <section aria-label="Found in your folders" className="flex flex-col gap-3 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h2 className="m-0 text-base font-semibold">
            {found.length === 1 ? '1 statement found in your folders needs an account' : `${found.length} statements found in your folders need an account`}
          </h2>
          {foundGroups.map((g) =>
            card(
              g,
              (choice, paths) =>
                void answerFound(paths, choice).then(() => {
                  setImportsVersion((v) => v + 1);
                  onImported?.();
                }),
              (paths) => skipFound(paths),
            ),
          )}
        </section>
      )}
      {status.phase === 'done' && summary && (
        <section aria-label="Import results" className="flex flex-col gap-3 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <h2 className="m-0 text-base font-semibold">
            Imported {summary.imported} transactions
            {summary.duplicates > 0 && `, skipped ${summary.duplicates} already seen`}
            {summary.failed > 0 && `, ${summary.failed} failed`}
            {summary.waiting > 0 && `, ${summary.waiting} ${summary.waiting === 1 ? 'needs an account' : 'need an account'}`}
          </h2>
          {resultGroups.map((g) =>
            card(
              g,
              (choice, ids) => void answer(ids, choice, results),
              (ids) => skip(ids),
            ),
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {status.results.map((r) => (
              <li key={r.name} className="flex justify-between">
                <span className="truncate">{r.name}</span>
                <span style={{ color: r.error ? 'var(--neg)' : 'var(--muted)' }}>{fileLine(r)}</span>
              </li>
            ))}
          </ul>
          <PossibleDuplicates results={status.results} />
        </section>
      )}
      <RecentImports refreshKey={importsVersion} onChanged={onImported} />
    </Page>
  );
}
