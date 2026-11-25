// Statements that need an account, grouped by the account they seem to be: one question per card, not per file.
import type { AccountChoice, NeedsAccount } from '@/lib/types';

export interface WaitingItem {
  id: string;
  name: string;
  needs: NeedsAccount;
}

export interface WaitingGroup {
  key: string;
  label: string;
  items: WaitingItem[];
  /** The group's statements together: rows added up, earliest to latest date, the first file's sample. */
  needs: NeedsAccount;
  /** No account number to go by: each file can be left out. */
  clueless: boolean;
}

const keyOf = (n: NeedsAccount) => (n.clues.last4 ? `${(n.clues.bank ?? '').trim().toLowerCase()}|${n.clues.last4}` : 'none');

const statements = (n: number) => `${n} ${n === 1 ? 'statement' : 'statements'}`;

function labelOf(first: NeedsAccount, count: number): string {
  const { bank, last4 } = first.clues;
  if (!last4) return `Statements without an account number · ${count}`;
  return `${bank ? `${bank} ending` : 'Ending'} ${last4} · ${statements(count)}`;
}

function merge(items: WaitingItem[]): NeedsAccount {
  const first = items[0].needs;
  const firsts = items.map((i) => i.needs.preview.first).filter((d): d is string => !!d).sort();
  const lasts = items.map((i) => i.needs.preview.last).filter((d): d is string => !!d).sort();
  return {
    ...first,
    guess: items.find((i) => i.needs.guess != null)?.needs.guess ?? null,
    preview: {
      ...first.preview,
      rows: items.reduce((sum, i) => sum + i.needs.preview.rows, 0),
      first: firsts[0] ?? null,
      last: lasts[lasts.length - 1] ?? null,
    },
  };
}

/** Group by bank and last 4 (bank case ignored), in the order the files came; files without a number go last. */
export function groupWaiting(items: WaitingItem[]): WaitingGroup[] {
  const byKey = new Map<string, WaitingItem[]>();
  for (const i of items) {
    const k = keyOf(i.needs);
    byKey.set(k, [...(byKey.get(k) ?? []), i]);
  }
  const keys = [...byKey.keys()].sort((a, b) => Number(a === 'none') - Number(b === 'none'));
  return keys.map((key) => {
    const group = byKey.get(key)!;
    return { key, label: labelOf(group[0].needs, group.length), items: group, needs: merge(group), clueless: key === 'none' };
  });
}

/** The best guess for Import all: the likely account, else a new one with the suggested name; null when neither. */
export function groupChoice(g: WaitingGroup): AccountChoice | null {
  if (g.needs.guess != null) return { kind: 'existing', sourceId: g.needs.guess, remember: true };
  const name = g.needs.suggestedName.trim();
  if (!name) return null;
  return {
    kind: 'new',
    account: { name, institution: g.needs.clues.bank?.trim() || null, accountType: 'card', color: null, defaultTagId: null },
    remember: true,
  };
}
