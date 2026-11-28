import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@/lib/types';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { MatchList, type MatchRow } from './match-list';

afterEach(() => cleanup());

const tx = (id: number, postedOn: string, description: string, cents: number): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn, description, merchant: description.toLowerCase(), amountCents: cents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: true, notes: null, refundOf: null,
});
const rows: MatchRow[] = [
  { transaction: tx(1, '2026-11-04', 'WISE US INC TRANSFER TO RENT', -167500) },
  { transaction: tx(2, '2026-10-30', 'WISE US INC TRANSFER TO SAM', -4000), similar: true },
  { transaction: tx(3, '2026-10-04', 'WISE US INC TRANSFER TO RENT', -167500), locked: true },
];

function Harness({ start = [], startOpen }: { start?: number[]; startOpen?: boolean }) {
  const [ticked, setTicked] = useState(new Set(start));
  return (
    <>
      <MatchList rows={rows} ticked={ticked} onChange={setTicked} categoriesById={{}} startOpen={startOpen} />
      <output aria-label="Ticked">{[...ticked].sort().join(',')}</output>
    </>
  );
}
const ticked = () => screen.getByRole('status', { name: 'Ticked' }).textContent;

describe('MatchList', () => {
  it('says how many match and hides them behind an ⓘ until asked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByText('Matches 3 transactions')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Matching transactions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show the matching transactions' }));
    const list = screen.getByRole('list', { name: 'Matching transactions' });
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(list).getByText('similar')).toBeInTheDocument();
    expect(within(list).getByText('locked')).toBeInTheDocument();
  });

  it('can start open', () => {
    render(<Harness startOpen />);
    expect(screen.getByRole('list', { name: 'Matching transactions' })).toBeInTheDocument();
  });

  it('ticks rows one by one, all at once, or none; a locked row never', async () => {
    const user = userEvent.setup();
    render(<Harness startOpen />);
    expect(ticked()).toBe('');
    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Include WISE US INC TRANSFER TO SAM on 2026-10-30' }));
    expect(ticked()).toBe('2');
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(ticked()).toBe('1,2');
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Include WISE US INC TRANSFER TO RENT on 2026-10-04' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Select none' }));
    expect(ticked()).toBe('');
  });

  it('opens a row’s statement details from its own ⓘ', async () => {
    setIpc(createMemoryIpc({ transactions: rows.map((r) => r.transaction) }));
    const user = userEvent.setup();
    render(<Harness startOpen />);
    await user.click(screen.getByRole('button', { name: 'Statement details for WISE US INC TRANSFER TO SAM on 2026-10-30' }));
    expect(screen.getAllByText(/WISE US INC TRANSFER TO SAM/).length).toBeGreaterThan(1);
  });

  it('with nothing matching, says so and offers no list', () => {
    render(<MatchList rows={[]} ticked={new Set()} onChange={() => {}} categoriesById={{}} />);
    expect(screen.getByText('No other transactions match')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show the matching transactions' })).toBeNull();
  });
});
