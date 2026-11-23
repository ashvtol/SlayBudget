import { useState } from 'react';
import { formatSignedMoney, shortDate } from '@/lib/format';
import type { AccountChoice, AccountType, NeedsAccount, Source, Tag } from '@/lib/types';

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

/** "Which account is activity.csv?": what's in the file, your accounts (the likely one first) or a new one. */
export function WhichAccount({
  fileName,
  needs,
  accounts,
  tags,
  onAnswer,
  onSkip,
}: {
  fileName: string;
  needs: NeedsAccount;
  accounts: Source[];
  tags: Tag[];
  onAnswer: (choice: AccountChoice) => void;
  onSkip: () => void;
}) {
  const ordered = [...accounts].sort((a, b) => Number(b.id === needs.guess) - Number(a.id === needs.guess));
  const [picked, setPicked] = useState<number | 'new'>(needs.guess ?? 'new');
  const [name, setName] = useState(needs.suggestedName);
  const [bank, setBank] = useState(needs.clues.bank ?? '');
  const [type, setType] = useState<AccountType>('card');
  const [tagId, setTagId] = useState<number | null>(null);
  const [remember, setRemember] = useState(true);
  const title = `Which account is ${fileName}?`;
  const field = 'h-[28px] rounded-md border bg-transparent px-2 text-[12px]';
  const fieldStyle = { borderColor: 'var(--line-strong)', color: 'var(--text)' };

  const submit = () =>
    onAnswer(
      picked === 'new'
        ? { kind: 'new', account: { name: name.trim(), institution: bank.trim() || null, accountType: type, color: null, defaultTagId: tagId }, remember }
        : { kind: 'existing', sourceId: picked, remember },
    );

  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: 'var(--accent)', background: 'var(--panel)' }}>
      <div>
        <h3 className="m-0 text-[14px] font-semibold">{title}</h3>
        <p className="m-0 mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          {needs.preview.rows} {needs.preview.rows === 1 ? 'transaction' : 'transactions'} · {span(needs.preview.first, needs.preview.last)}
          {cluesLine(needs) && ` · ${cluesLine(needs)}`}
        </p>
      </div>
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
            <input type="radio" name={`account-${fileName}`} checked={picked === a.id} onChange={() => setPicked(a.id)} aria-label={a.id === needs.guess ? `${a.name} Likely` : a.name} />
            {a.name}
            {a.id === needs.guess && <span className="rounded px-1 text-[10px] font-semibold" style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', color: 'var(--accent)' }}>Likely</span>}
          </label>
        ))}
        <label className="flex h-[28px] cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-semibold" style={{ borderColor: picked === 'new' ? 'var(--accent)' : 'var(--line-strong)' }}>
          <input type="radio" name={`account-${fileName}`} checked={picked === 'new'} onChange={() => setPicked('new')} aria-label="New account" />
          New account
        </label>
      </div>
      {picked === 'new' && (
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Account name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${field} w-[180px]`} style={fieldStyle} />
          <input aria-label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Bank" className={`${field} w-[140px]`} style={fieldStyle} />
          <div role="radiogroup" aria-label="Type" className="flex rounded-md border p-0.5" style={{ borderColor: 'var(--line-strong)' }}>
            {TYPES.map(([value, label]) => (
              <label
                key={value}
                className="flex cursor-pointer items-center rounded px-2 py-0.5 text-[12px]"
                style={type === value ? { background: 'color-mix(in srgb, var(--accent) 22%, transparent)', color: 'var(--accent)', fontWeight: 600 } : { color: 'var(--muted)' }}
              >
                <input type="radio" className="sr-only" name={`type-${fileName}`} checked={type === value} onChange={() => setType(value)} aria-label={label} />
                {label}
              </label>
            ))}
          </div>
          <select aria-label="Default tag" value={tagId ?? ''} onChange={(e) => setTagId(e.target.value ? Number(e.target.value) : null)} className={field} style={fieldStyle}>
            <option value="">No default tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} aria-label="Remember for files like this" />
          Remember for files like this
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onSkip} className="h-[28px] rounded-md border px-3 text-[12px] font-semibold" style={{ borderColor: 'var(--line-strong)', color: 'var(--text)' }}>
            Skip
          </button>
          <button
            type="button"
            disabled={picked === 'new' && !name.trim()}
            onClick={submit}
            className="h-[28px] rounded-md px-3 text-[12px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}
          >
            Import
          </button>
        </div>
      </div>
    </section>
  );
}
