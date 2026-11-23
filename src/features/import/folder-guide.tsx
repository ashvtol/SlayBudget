import { useNavStore } from '@/lib/stores/nav-store';
import { Button } from '@/components/button';

const TREE = [
  ['Statements/', '', 0],
  ['Amex Gold/', 'Amex Gold', 1],
  ['2026-11.csv', '', 2],
  ['Citi Checking/', 'Citi Checking, tagged Bills', 1],
  ['november.pdf', '', 2],
] as const;

/** How to keep statements organized: a folder per account in the watched folder, so each lands in its account. */
export function FolderGuide() {
  const openSettingsPane = useNavStore((s) => s.openSettingsPane);
  return (
    <section aria-label="Keep statements organized" className="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-2xl border p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex min-w-[260px] flex-1 flex-col gap-2">
        <h2 className="m-0 text-[14px] font-semibold">Keep statements organized</h2>
        <p className="m-0 text-[12px] leading-relaxed" style={{ color: 'var(--muted)' }}>
          Give each account its own folder inside your watched folder. A statement you drop into one goes straight into
          that account, and gets the account's default tag if it has one. Files anywhere else are recognized from what's
          in them, or SlayBudget asks you once.
        </p>
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-4 text-[12px]" style={{ color: 'var(--muted)' }}>
          <li>Choose a watched folder in Settings, Import sources.</li>
          <li>Make a folder for each account in Settings, Accounts.</li>
          <li>Drop statements in. SlayBudget checks every couple of minutes.</li>
        </ol>
        <Button onClick={() => openSettingsPane('accounts')} className="mt-1 w-fit">
          Set up folders
        </Button>
      </div>
      <div
        role="img"
        aria-label="Example folders: Statements, with an Amex Gold folder and a Citi Checking folder, each holding that account's statements"
        className="flex flex-col gap-1 rounded-lg px-4 py-3 font-mono text-[12px]"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}
      >
        {TREE.map(([name, account, depth]) => (
          <div key={name} className="flex items-center gap-3" style={{ paddingLeft: depth * 16 }}>
            <span style={{ color: name.endsWith('/') ? 'var(--text)' : 'var(--muted)' }}>{name}</span>
            {account && <span className="font-sans text-[11px]" style={{ color: 'var(--accent)' }}>→ {account}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
