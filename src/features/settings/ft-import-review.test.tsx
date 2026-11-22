import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { Category, FtProposal } from '@/lib/types';
import { FtImportReview } from './ft-import-review';

afterEach(() => cleanup());

const cat = (id: number, name: string): Category => ({
  id, groupId: id, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const categories = [cat(1, 'Other'), cat(3, 'Restaurants'), cat(4, 'Healthcare'), cat(5, 'Games')];

const proposals: FtProposal[] = [
  { merchant: 'din tai', ftCategory: 'Food & Dining', target: { kind: 'existing', value: 3 }, moves: 6 },
  { merchant: 'mayuri foods', ftCategory: 'Food & Dining', target: { kind: 'existing', value: 3 }, moves: 11 },
  { merchant: 'playstation network', ftCategory: 'Healthcare', target: { kind: 'existing', value: 4 }, moves: 1 },
  { merchant: 'the knot', ftCategory: 'Wedding', target: { kind: 'new', value: 'Wedding' }, moves: 2 },
];

function setup() {
  const onImport = vi.fn().mockResolvedValue({ learned: 3, moved: 19, created: 1 });
  const onCancel = vi.fn();
  render(<FtImportReview proposals={proposals} categories={categories} onImport={onImport} onCancel={onCancel} />);
  return { onImport, onCancel };
}

const review = () => screen.getByRole('region', { name: 'Review imported rules' });

describe('FtImportReview', () => {
  it('groups proposals by target with totals', () => {
    setup();
    const restaurants = within(review()).getByRole('group', { name: /Restaurants/ });
    expect(restaurants).toHaveTextContent('2 merchants, 17 transactions');
    expect(within(review()).getByRole('group', { name: /New category: Wedding/ })).toHaveTextContent('1 merchant, 2 transactions');
    expect(within(review()).getByRole('button', { name: 'Import 4 merchants' })).toBeEnabled();
  });

  it('unticking leaves a merchant out', async () => {
    const user = userEvent.setup();
    const { onImport } = setup();
    await user.click(within(review()).getByRole('checkbox', { name: 'Include playstation network' }));
    await user.click(within(review()).getByRole('button', { name: 'Import 3 merchants' }));
    expect(onImport).toHaveBeenCalledWith([
      { merchant: 'din tai', target: { kind: 'existing', value: 3 } },
      { merchant: 'mayuri foods', target: { kind: 'existing', value: 3 } },
      { merchant: 'the knot', target: { kind: 'new', value: 'Wedding' } },
    ]);
  });

  it('changing the category sends the new target', async () => {
    const user = userEvent.setup();
    const { onImport } = setup();
    await user.selectOptions(within(review()).getByRole('combobox', { name: 'Category for playstation network' }), 'Games');
    await user.click(within(review()).getByRole('button', { name: 'Import 4 merchants' }));
    expect(onImport.mock.calls[0][0]).toContainEqual({ merchant: 'playstation network', target: { kind: 'existing', value: 5 } });
  });

  it('shows the result', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(within(review()).getByRole('button', { name: 'Import 4 merchants' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Learned 3 merchants, moved 19 transactions.'));
  });
});
