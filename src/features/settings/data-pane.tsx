import { useEffect, useRef, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { isTauri } from '@/lib/tauri-ipc';
import type { Category, FtProposal, LegacyReport } from '@/lib/types';
import { FtImportReview } from './ft-import-review';

/** Today as YYYY-MM-DD in the person's own time zone (toISOString would give UTC's date). */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const BUTTON = 'mt-2 min-h-8 self-start rounded-lg border px-3 text-sm font-medium hover:bg-[var(--hover)] disabled:opacity-50';
const BUTTON_STYLE = { borderColor: 'var(--line-strong)', color: 'var(--accent)' };

/** Data & backup: counts, importing a JSON export and merchant rules, and backing up the database. */
export function DataPane() {
  const [count, setCount] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<LegacyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rulesRef = useRef<HTMLInputElement>(null);
  const [proposals, setProposals] = useState<FtProposal[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [backedUp, setBackedUp] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportRules = async () => {
    setExportError(null);
    setExported(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const stamp = localDay();
      const path = await save({ title: 'Export rules', defaultPath: `slaybudget-rules-${stamp}.json`, filters: [{ name: 'Rules', extensions: ['json'] }] });
      if (!path) return;
      const r = await ipc().exportRules(path);
      const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? '' : 's'}`;
      setExported(
        `Exported ${plural(r.learned, 'merchant')} and ${plural(r.rules, 'rule')}.` +
          (r.leftOut > 0 ? ` Left out ${r.leftOut.toLocaleString()} that could identify you or your accounts.` : ''),
      );
    } catch (e) {
      setExportError(`Couldn’t export: ${(e as Error).message ?? String(e)}`);
    }
  };

  const backUp = async () => {
    setBackupError(null);
    setBackedUp(null);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const stamp = localDay();
      const path = await save({ title: 'Back up SlayBudget', defaultPath: `slaybudget-backup-${stamp}.db`, filters: [{ name: 'SlayBudget backup', extensions: ['db'] }] });
      if (!path) return;
      await ipc().backupDatabase(path);
      setBackedUp(path);
    } catch (e) {
      setBackupError(`Couldn’t back up: ${(e as Error).message ?? String(e)}`);
    }
  };

  const onRulesFile = async (file: File) => {
    setRulesError(null);
    try {
      const [p, cats] = await Promise.all([ipc().previewFtModel(await file.text()), ipc().listCategories()]);
      setCategories(cats);
      setProposals(p);
    } catch (e) {
      setRulesError(`Couldn’t read that file: ${(e as Error).message ?? String(e)}`);
    } finally {
      if (rulesRef.current) rulesRef.current.value = '';
    }
  };

  const refresh = () => void ipc().countTransactions({}).then(setCount);
  useEffect(refresh, []);

  const onFile = async (file: File) => {
    setImporting(true);
    setError(null);
    setReport(null);
    try {
      const text = await file.text();
      const r = await ipc().migrateLegacyJson(text, null);
      setReport(r);
      refresh();
    } catch (e) {
      setError(`Couldn’t import: ${(e as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section aria-label="Data and backup" className="flex flex-col gap-5 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Your data</span>
        <span className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>
          {count == null ? '…' : `${count.toLocaleString()} transactions`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
        <span className="text-sm font-medium">Import transactions</span>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Bring in history from another app's JSON export. Duplicates are skipped. For bank and card statements (CSV), use Import in the sidebar.
        </p>
        <button type="button" disabled={importing} onClick={() => fileRef.current?.click()} className={BUTTON} style={BUTTON_STYLE}>
          Import transactions…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Transactions file"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
          className="hidden"
        />
        {importing && <span className="text-xs" style={{ color: 'var(--muted)' }}>Importing…</span>}
        {report && (
          <p className="m-0 text-xs" style={{ color: 'var(--pos)' }}>
            Imported {report.transactionsInserted.toLocaleString()} transactions
            {report.transactionsDuplicate > 0 && `, skipped ${report.transactionsDuplicate.toLocaleString()} duplicates`}.
          </p>
        )}
        {error && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{error}</p>}
      </div>

      <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
        <span className="text-sm font-medium">Import categorization rules</span>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Choose a JSON file of merchants and their categories (such as another app's learned rules). You review them before anything changes.
        </p>
        {proposals == null ? (
          <>
          <button type="button" onClick={() => rulesRef.current?.click()} className={BUTTON} style={BUTTON_STYLE}>
            Import rules…
          </button>
          <input
            ref={rulesRef}
            type="file"
            accept="application/json,.json"
            aria-label="Rules file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onRulesFile(f);
            }}
            className="hidden"
          />
          </>
        ) : (
          <FtImportReview
            proposals={proposals}
            categories={categories}
            onImport={async (choices) => {
              const r = await ipc().importFtModel(choices);
              refresh();
              return r;
            }}
            onCancel={() => setProposals(null)}
          />
        )}
        {rulesError && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{rulesError}</p>}
      </div>

      <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
        <span className="text-sm font-medium">Export categorization rules</span>
        <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
          Save the merchants SlayBudget has learned and your rules to a file you can import elsewhere. Nothing about you goes in it: no accounts, reference numbers, payees or names.
        </p>
        {isTauri() ? (
          <>
            <button type="button" onClick={() => void exportRules()} className={BUTTON} style={BUTTON_STYLE}>
              Export rules…
            </button>
            {exported && <p className="m-0 text-xs" style={{ color: 'var(--pos)' }}>{exported}</p>}
            {exportError && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{exportError}</p>}
          </>
        ) : (
          <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Exporting is available in the installed app.</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
        <span className="text-sm font-medium">Backup</span>
        {isTauri() ? (
          <>
            <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>
              Your data lives in one local database file. Save a complete copy anywhere you like; Time Machine backs it up too.
            </p>
            <button type="button" onClick={() => void backUp()} className={BUTTON} style={BUTTON_STYLE}>
              Back up now…
            </button>
            {backedUp && <p role="status" className="m-0 text-xs" style={{ color: 'var(--pos)' }}>Backed up to {backedUp}</p>}
            {backupError && <p className="m-0 text-xs" style={{ color: 'var(--neg)' }}>{backupError}</p>}
          </>
        ) : (
          <p className="m-0 text-xs" style={{ color: 'var(--muted)' }}>Backup and restore are available in the installed app.</p>
        )}
      </div>
    </section>
  );
}
