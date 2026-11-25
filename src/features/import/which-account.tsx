import { useState } from 'react';
import { formatSignedMoney, shortDate } from '@/lib/format';
import type { AccountChoice, AccountType, NeedsAccount, Source, Tag } from '@/lib/types';
import { Select } from '@/components/select';
import { SegmentedControl } from '@/components/segmented-control';
import { Button } from '@/components/button';

const TYPES: [AccountType, string][] = [
  ['card', 'Card'],
  ['checking', 'Checking'],
  ['savings', 'Savings'],
];

/** "Nov 3 to Nov 5, 2026" */
function span(first: string | null, last: string | null): string {
  if (!first || !last) return '';
  const year = last.slice(0, 4);
  return first === last ? `${shortDate(first)}, ${year}` : `${shortDate(first)} to ${shortDate(last)}, ${year}`;
}

/** "Chase, ending 7781" */
function cluesLine(n: NeedsAccount): string {
  const { bank, last4 } = n.clues;
  if (bank && last4) return `${bank}, ending ${last4}`;
  if (last4) return `Ending ${last4}`;
  return bank ?? '';
}

/** "Which account is activity.csv?" (or a group: "Which account is Chase ending 7781?"): what's in the statements,
 *  your accounts (the likely one first) or a new one. A group lists its files; `selectable` lets you leave some out. */
export function WhichAccount({
  title,
  fileNames,
  selectable = false,
  needs,
  accounts,
  tags,
  onAnswer,
  onSkip,
}: {
  title: string;
  fileNames: string[];
  selectable?: boolean;
  needs: NeedsAccount;
  accounts: Source[];
  tags: Tag[];
  /** `chosen`: the file names to import (all of them unless some were unticked). */
  onAnswer: (choice: AccountChoice, chosen: string[]) => void;
  onSkip: () => void;
}) {
  const ordered = [...accounts].sort((a, b) => Number(b.id === needs.guess) - Number(a.id === needs.guess));
  const [picked, setPicked] = useState<number | 'new'>(needs.guess ?? 'new');
  const [name, setName] = useState(needs.suggestedName);
  const [bank, setBank] = useState(needs.clues.bank ?? '');
  const [type, setType] = useState<AccountType>('card');
  const [tagId, setTagId] = useState<number | null>(null);
  const [remember, setRemember] = useState(true);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const chosen = fileNames.filter((f) => !left.has(f));
  const field = 'field';
  const toggle = (f: string) =>
    setLeft((s) => {
      const next = new Set(s);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const submit = () =>
    onAnswer(
      picked === 'new'
        ? { kind: 'new', account: { name: name.trim(), institution: bank.trim() || null, accountType: type, color: null, defaultTagId: tagId }, remember }
        : { kind: 'existing', sourceId: picked, remember },
      chosen,
    );

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--accent)', background: 'var(--panel)' }}>
      <div>
        <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
        <p className="m-0 mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          {fileNames.length > 1 && `${fileNames.length} statements · `}
          {needs.preview.rows} {needs.preview.rows === 1 ? 'transaction' : 'transactions'} · {span(needs.preview.first, needs.preview.last)}
          {cluesLine(needs) && ` · ${cluesLine(needs)}`}
          {fileNames.length > 1 && !cluesLine(needs) && ' · Statements without an account number'}
        </p>
      </div>
      {fileNames.length > 1 && (
        <details open={selectable} className="text-[12px]">
          <summary className="cursor-default" style={{ color: 'var(--muted)' }}>
            Show {fileNames.length} files
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
            {fileNames.map((f) => (
              <li key={f} className="truncate">
                {selectable ? (
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!left.has(f)} onChange={() => toggle(f)} aria-label={f} />
                    {f}
                  </label>
                ) : (
                  f
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px]">
        {needs.preview.sample.map((r, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-[52px] shrink-0" style={{ color: 'var(--muted)' }}>{shortDate(r.postedOn)}</span>
            <span className="min-w-0 flex-1 truncate">{r.description}</span>
            <span className="tabular-nums">{formatSignedMoney(r.amountCents, 'USD')}</span>
          </li>
        ))}
      </ul>
      <div role="radiogroup" aria-label="Account" className="flex flex-wrap gap-1.5">
        {ordered.map((a) => (
          <label key={a.id} className="flex h-[28px] cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold" style={{ borderColor: picked === a.id ? 'var(--accent)' : 'var(--line-strong)' }}>
            <input type="radio" name={`account-${title}`} checked={picked === a.id} onChange={() => setPicked(a.id)} aria-label={a.id === needs.guess ? `${a.name} Likely` : a.name} />
            {a.name}
            {a.id === needs.guess && <span className="rounded px-1 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }}>Likely</span>}
          </label>
        ))}
        <label className="flex h-[28px] cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold" style={{ borderColor: picked === 'new' ? 'var(--accent)' : 'var(--line-strong)' }}>
          <input type="radio" name={`account-${title}`} checked={picked === 'new'} onChange={() => setPicked('new')} aria-label="New account" />
          New account
        </label>
      </div>
      {picked === 'new' && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${field} w-[180px]`} />
          <input aria-label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Bank" className={`${field} w-[140px]`} />
          <SegmentedControl aria-label="Type" options={TYPES.map(([id, label]) => ({ id, label }))} value={type} onChange={setType} />
          <Select aria-label="Default tag" value={tagId ?? ''} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">No default tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Remember for files like this" />
          Remember for files like this
        </label>
        <div className="flex gap-2">
          <Button onClick={onSkip}>
            Skip
          </Button>
          <Button variant="primary" disabled={(picked === 'new' && !name.trim()) || chosen.length === 0} onClick={submit}>
            Import
          </Button>
        </div>
      </div>
    </section>
  );
}
