import { useCallback, useEffect, useState } from 'react';
import { ipc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { AccountClue, AccountType, Source, Tag } from '@/lib/types';
import { Select } from '@/components/select';
import { SegmentedControl } from '@/components/segmented-control';
import { Button } from '@/components/button';

const TYPES: [AccountType, string][] = [
  ['card', 'Card'],
  ['checking', 'Checking'],
  ['savings', 'Savings'],
];

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Chase, ending 1004", "CSV files with columns Amount, Date", "QFX, OFX, QBO or QIF files", "PDF statements from Citi". */
export function describeClue(c: AccountClue): string {
  if (c.kind === 'last4') {
    const [bank, digits] = c.value.split('|');
    return bank ? `${bank}, ending ${digits}` : `Ending ${digits}`;
  }
  if (c.value === 'ofx') return 'QFX, OFX, QBO or QIF files';
  if (c.value.startsWith('pdf:')) return `PDF statements from ${c.value.slice(4).replace(/\b\w/g, (x) => x.toUpperCase())}`;
  if (c.value.startsWith('csv:')) return `CSV files with columns ${c.value.slice(4).split('|').map(capitalize).join(', ')}`;
  return c.value;
}

/** Settings > Accounts: name, bank, type, default tag and what each account is recognized by; account folders. */
export function AccountsPane() {
  const activeProfile = useProfileStore((s) => s.activeProfileId);
  const profiles = useProfileStore((s) => s.profiles);
  const profileId = activeProfile ?? profiles[0]?.id ?? null;
  const [accounts, setAccounts] = useState<Source[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    void ipc()
      .listSources()
      .then((all) => setAccounts(all.filter((a) => profileId == null || a.profileId === profileId)));
    void ipc().listTags().then(setTags);
  }, [profileId]);
  useEffect(load, [load]);

  const folders = async () => {
    if (profileId == null) return;
    try {
      const { folder, created } = await ipc().createAccountFolders(profileId);
      setStatus(created.length ? `Made ${created.length} ${created.length === 1 ? 'folder' : 'folders'} in ${folder}.` : `Every account already has a folder in ${folder}.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section aria-label="Accounts" className="flex flex-col gap-4">
      <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
        SlayBudget recognizes which account a statement belongs to and asks you once when it isn't sure. Your answers
        are listed here as what each account is recognized by.
      </p>
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} tags={tags} onChanged={load} />
      ))}
      <div className="flex flex-col gap-1.5 rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
        <div className="text-[13px] font-semibold">Account folders</div>
        <p className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
          Make a folder for each account inside your watched folder (Import sources). A statement you drop into one is
          imported into that account.
        </p>
        <Button onClick={() => void folders()} className="mt-1 w-fit">
          Create a folder for each account
        </Button>
        {status && (
          <p role="status" className="m-0 text-[12px]" style={{ color: 'var(--muted)' }}>
            {status}
          </p>
        )}
      </div>
    </section>
  );
}

function AccountCard({ account, tags, onChanged }: { account: Source; tags: Tag[]; onChanged: () => void }) {
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState(account.institution ?? '');
  const [tagId, setTagId] = useState<number | null>(account.defaultTagId ?? null);
  const [alsoExisting, setAlsoExisting] = useState(false);
  const [existing, setExisting] = useState(0);
  const [clues, setClues] = useState<AccountClue[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadClues = useCallback(() => void ipc().accountClues(account.id).then(setClues), [account.id]);
  useEffect(loadClues, [loadClues]);
  useEffect(() => {
    void ipc().countTransactions({ sourceIds: [account.id] }).then(setExisting);
  }, [account.id]);

  const save = async (patch: Parameters<ReturnType<typeof ipc>['updateAccount']>[1]) => {
    try {
      setError(null);
      await ipc().updateAccount(account.id, patch);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const field = 'field';
  const tagChanged = tagId !== (account.defaultTagId ?? null);

  return (
    <div role="group" aria-label={account.name} className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() !== account.name && void save({ name })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`${field} w-[200px] font-semibold`}
        />
        <input
          aria-label="Bank"
          placeholder="Bank"
          value={bank}
          onChange={(e) => setBank(e.target.value)}
          onBlur={() => bank.trim() !== (account.institution ?? '') && void save({ institution: bank.trim() || null })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={`${field} w-[150px]`}
        />
        <SegmentedControl aria-label="Type" options={TYPES.map(([id, label]) => ({ id, label }))} value={account.accountType} onChange={(v) => void save({ accountType: v })} />
      </div>
      {error && <p role="alert" className="m-0 text-[12px]" style={{ color: 'var(--neg)' }}>{error}</p>}
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span style={{ color: 'var(--muted)' }}>Default tag</span>
        <Select aria-label="Default tag" value={tagId ?? ''} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        {tagChanged && (
          <>
            {tagId != null && existing > 0 && (
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={alsoExisting} onChange={(e) => setAlsoExisting(e.target.checked)} />
                Also tag the {existing} {existing === 1 ? 'transaction' : 'transactions'} already in {account.name}
              </label>
            )}
            <Button variant="primary" onClick={() => void ipc().setAccountDefaultTag(account.id, tagId, alsoExisting).then(onChanged)} aria-label="Save default tag">
              Save
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1 text-[12px]">
        <span style={{ color: 'var(--muted)' }}>Recognized by</span>
        {clues.length === 0 ? (
          <span style={{ color: 'var(--subtle)' }}>Nothing yet: asked on its next import.</span>
        ) : (
          <ul aria-label="Recognized by" className="m-0 flex list-none flex-col gap-1 p-0">
            {clues.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span>{describeClue(c)}</span>
                <button
                  type="button"
                  aria-label={`Forget ${describeClue(c)}`}
                  onClick={() => void ipc().forgetAccountClue(c.id).then(loadClues)}
                  className="h-[22px] rounded-md px-2 text-[11px] font-semibold hover:bg-[var(--hover)]"
                  style={{ color: 'var(--muted)' }}
                >
                  Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
