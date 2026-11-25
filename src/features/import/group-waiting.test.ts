import type { NeedsAccount } from '@/lib/types';
import { groupChoice, groupWaiting, type WaitingItem } from './group-waiting';

function needs(over: { bank?: string | null; last4?: string | null; guess?: number | null; name?: string; rows?: number; first?: string; last?: string } = {}): NeedsAccount {
  return {
    clues: { bank: over.bank === undefined ? 'Chase' : over.bank, last4: over.last4 === undefined ? '7781' : over.last4, layout: null, folder: null },
    guess: over.guess ?? null,
    suggestedName: over.name ?? 'Chase 7781',
    preview: {
      rows: over.rows ?? 10,
      first: over.first ?? '2026-01-03',
      last: over.last ?? '2026-01-30',
      sample: [{ postedOn: over.first ?? '2026-01-03', description: `row from ${over.first ?? 'jan'}`, amountCents: -500 }],
    },
  } as NeedsAccount;
}
const item = (id: string, n: NeedsAccount): WaitingItem => ({ id, name: `${id}.pdf`, needs: n });

describe('groupWaiting', () => {
  it('groups by bank and last 4, in the order the files came', () => {
    const groups = groupWaiting([
      item('a', needs()),
      item('b', needs({ bank: 'Amex', last4: '1009', name: 'Amex 1009' })),
      item('c', needs()),
      item('d', needs()),
    ]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'c', 'd'], ['b']]);
    expect(groups[0].label).toBe('Chase ending 7781 · 3 statements');
    expect(groups[1].label).toBe('Amex ending 1009 · 1 statement');
    expect(groups.every((g) => !g.clueless)).toBe(true);
  });

  it('keeps the same last 4 at two banks apart, but ignores how the bank name is capitalized', () => {
    expect(groupWaiting([item('a', needs()), item('b', needs({ bank: 'Citi' }))])).toHaveLength(2);
    expect(groupWaiting([item('a', needs()), item('b', needs({ bank: 'CHASE' }))])).toHaveLength(1);
  });

  it('puts statements without an account number in one group, last', () => {
    const groups = groupWaiting([item('a', needs({ last4: null })), item('b', needs()), item('c', needs({ last4: null, bank: null }))]);
    expect(groups).toHaveLength(2);
    const last = groups[1];
    expect(last.key).toBe('none');
    expect(last.clueless).toBe(true);
    expect(last.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(last.label).toBe('Statements without an account number · 2');
  });

  it('merges the previews: rows added up, earliest to latest, the first file’s sample, the first guess', () => {
    const [g] = groupWaiting([
      item('a', needs({ rows: 10, first: '2026-03-01', last: '2026-03-31' })),
      item('b', needs({ rows: 7, first: '2026-01-02', last: '2026-01-31', guess: 4 })),
      item('c', needs({ rows: 3, first: '2026-05-01', last: '2026-05-30', guess: 8 })),
    ]);
    expect(g.needs.preview.rows).toBe(20);
    expect(g.needs.preview.first).toBe('2026-01-02');
    expect(g.needs.preview.last).toBe('2026-05-30');
    expect(g.needs.preview.sample[0].description).toBe('row from 2026-03-01');
    expect(g.needs.guess).toBe(4);
  });
});

describe('groupChoice', () => {
  it('uses the likely account when there is one', () => {
    const [g] = groupWaiting([item('a', needs({ guess: 4 }))]);
    expect(groupChoice(g)).toEqual({ kind: 'existing', sourceId: 4, remember: true });
  });

  it('otherwise makes a new account with the suggested name', () => {
    const [g] = groupWaiting([item('a', needs())]);
    expect(groupChoice(g)).toEqual({
      kind: 'new',
      account: { name: 'Chase 7781', institution: 'Chase', accountType: 'card', color: null, defaultTagId: null },
      remember: true,
    });
  });

  it('gives no choice when there is no guess and no name', () => {
    const [g] = groupWaiting([item('a', needs({ name: '  ' }))]);
    expect(groupChoice(g)).toBeNull();
  });
});
