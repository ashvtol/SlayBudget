import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useNavStore } from '@/lib/stores/nav-store';
import { useAnalyticsStore } from '@/features/analytics/analytics-store';
import { DashboardTips } from './dashboard-tips';
import { useHabitsStore } from './habits-store';

afterEach(() => cleanup());

const cat = (id: number, name: string, extra: Partial<Category> = {}): Category => ({
  id, groupId: 1, name, emoji: null, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false, ...extra,
});
let nextId = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number, txType: Transaction['txType'] = 'regular'): Transaction => ({
  id: nextId++, profileId: 1, sourceId: 1, postedOn, description: 'X', merchant: 'x', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType,
});

beforeEach(() => {
  // Six months: $6,200 in; $4,000 rent makes needs 65% of income (a warn tip).
  const rows: Transaction[] = [];
  for (let i = 0; i < 6; i++) {
    const m = new Date(Date.UTC(2026, 5 + i, 1)).toISOString().slice(0, 7);
    rows.push(tx(`${m}-01`, 620000, 4, 'income'), tx(`${m}-02`, -400000, 1), tx(`${m}-05`, -70000, 2));
  }
  setIpc(createMemoryIpc({ categories: [cat(1, 'Rent'), cat(2, 'Restaurants'), cat(4, 'Salary', { kind: 'income' })], transactions: rows }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21' });
  useHabitsStore.setState(useHabitsStore.getInitialState());
});

describe('Dashboard Tips card', () => {
  it('shows the style, the savings rate against the target, and the two most useful tips', async () => {
    render(<DashboardTips />);
    const card = await screen.findByRole('region', { name: 'Tips' });
    await waitFor(() => expect(card).toHaveTextContent('🔥 Savings rate'));
    expect(card).toHaveTextContent('24% of 35% goal');
    const tips = within(card).getAllByRole('article');
    expect(tips).toHaveLength(2);
    expect(tips[0]).toHaveAccessibleName('Needs take most of your income');
  });

  it('leaves out hidden tips', async () => {
    await ipc().setSetting('hidden_tips', JSON.stringify([{ id: 'split', hiddenAt: '2026-11-20', value: 24 }]));
    render(<DashboardTips />);
    const card = await screen.findByRole('region', { name: 'Tips' });
    await waitFor(() => expect(within(card).getAllByRole('article')).toHaveLength(2));
    expect(within(card).queryByRole('article', { name: 'Needs take most of your income' })).not.toBeInTheDocument();
  });

  it('links to Insights', async () => {
    const user = userEvent.setup();
    render(<DashboardTips />);
    const card = await screen.findByRole('region', { name: 'Tips' });
    await user.click(within(card).getByRole('button', { name: /Insights/ }));
    expect(useNavStore.getState().section).toBe('insights');
  });

  it('is not shown without history', async () => {
    setIpc(createMemoryIpc({ transactions: [] }));
    const { container } = render(<DashboardTips />);
    await waitFor(() => expect(useHabitsStore.getState().data).not.toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});
