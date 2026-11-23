import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { Category, CategoryGroup, Transaction } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useAnalyticsStore } from './analytics-store';
import { InsightsPage } from './insights-page';

afterEach(() => cleanup());

const groups: CategoryGroup[] = [{ id: 1, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 0 }];
const cat = (id: number, name: string): Category => ({
  id, groupId: 1, name, emoji: '🍽️', color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
let id = 1;
const tx = (postedOn: string, amountCents: number, categoryId: number): Transaction => ({
  id: id++, profileId: 1, sourceId: 1, postedOn, description: 'DIN TAI', merchant: 'din tai', amountCents, currency: 'USD',
  categoryId, categoryLocked: false, reviewed: true, notes: null, refundOf: null, txType: 'regular',
});

async function setup() {
  setIpc(createMemoryIpc({
    groups,
    categories: [cat(10, 'Restaurants'), cat(11, 'Groceries')],
    transactions: [tx('2026-11-10', -6000, 10), tx('2026-11-12', -4000, 11), tx('2026-03-05', -20000, 11)],
  }));
  useProfileStore.setState({ activeProfileId: null });
  useAnalyticsStore.setState({ today: '2026-11-21', range: 'threeMonths' });
  render(<InsightsPage />);
  return screen.findByRole('region', { name: 'Where your money went' });
}

describe('Insights spending map', () => {
  it('shows the total and each category for the range', async () => {
    const card = await setup();
    await waitFor(() => expect(card).toHaveTextContent('$100.00'));
    expect(within(card).getByRole('group', { name: /Spending map/ })).toBeInTheDocument();
    const table = within(card).getByRole('table', { name: 'Spending by category' });
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Category'),
      expect.stringMatching(/Restaurants.*\$60\.00.*60%/),
      expect.stringMatching(/Groceries.*\$40\.00.*40%/),
    ]);
  });

  it('reshapes when the range changes', async () => {
    const user = userEvent.setup();
    const card = await setup();
    await waitFor(() => expect(card).toHaveTextContent('$100.00'));
    await user.click(screen.getByRole('radio', { name: '1Y' }));
    await waitFor(() => expect(card).toHaveTextContent('$300.00'));
    expect(within(card).getByRole('table', { name: 'Spending by category' })).toHaveTextContent(/Groceries.*\$240\.00/);
  });

  it('says so when nothing was spent', async () => {
    setIpc(createMemoryIpc({ groups, categories: [cat(10, 'Restaurants')], transactions: [] }));
    useAnalyticsStore.setState({ today: '2026-11-21', range: 'month' });
    render(<InsightsPage />);
    expect(await screen.findByText('No spending in this period.')).toBeInTheDocument();
  });
});

describe('Insights spending map: hiding categories', () => {
  it('hides a chosen category, says how much is hidden, and remembers it', async () => {
    const user = userEvent.setup();
    const card = await setup();
    await waitFor(() => expect(card).toHaveTextContent('$100.00'));
    await user.click(within(card).getByRole('button', { name: 'Hide categories' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Restaurants' }));
    await waitFor(() => expect(card).toHaveTextContent('$60.00 hidden: Restaurants'));
    expect(within(card).getByRole('table', { name: 'Spending by category' })).not.toHaveTextContent('Restaurants');
    expect(JSON.parse((await ipc().getSetting('insights.hiddenCategories')) ?? '[]')).toEqual(['10']);
    cleanup();
    render(<InsightsPage />);
    const again = await screen.findByRole('region', { name: 'Where your money went' });
    await waitFor(() => expect(again).toHaveTextContent('hidden: Restaurants'));
  });

  it('offers a quick "Hide Other"', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({
      groups,
      categories: [cat(10, 'Restaurants'), { ...cat(99, 'Other'), groupId: 1 }],
      transactions: [tx('2026-11-10', -6000, 10), tx('2026-11-11', -9000, 99)],
    }));
    useAnalyticsStore.setState({ today: '2026-11-21', range: 'threeMonths' });
    render(<InsightsPage />);
    const card = await screen.findByRole('region', { name: 'Where your money went' });
    await user.click(await within(card).findByRole('button', { name: 'Hide Other' }));
    await waitFor(() => expect(card).toHaveTextContent('$90.00 hidden: Other'));
    await user.click(within(card).getByRole('button', { name: 'Show Other' }));
    await waitFor(() => expect(card).not.toHaveTextContent('hidden'));
  });
});

describe('Insights spending map: full window', () => {
  it('expands to fill the app, keeps the range picker, and closes with Escape or Close', async () => {
    const user = userEvent.setup();
    const card = await setup();
    await waitFor(() => expect(card).toHaveTextContent('$100.00'));
    await user.click(within(card).getByRole('button', { name: 'Expand map' }));
    const big = screen.getByRole('dialog', { name: 'Where your money went' });
    expect(big).toHaveAttribute('aria-modal', 'true');
    expect(within(big).getByRole('radio', { name: '1Y' })).toBeInTheDocument();
    await user.click(within(big).getByRole('radio', { name: '1Y' }));
    await waitFor(() => expect(big).toHaveTextContent('$300.00'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Where your money went' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Expand map' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Where your money went' })).getByRole('button', { name: 'Close map' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Insights spending map: saved hidden categories', () => {
  it('waits for the saved choices before drawing the map', async () => {
    const memory = createMemoryIpc({
      groups,
      categories: [cat(10, 'Restaurants'), cat(11, 'Groceries')],
      transactions: [tx('2026-11-10', -6000, 10), tx('2026-11-12', -4000, 11)],
      settings: { 'insights.hiddenCategories': '["10"]' },
    });
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const getSetting = memory.getSetting.bind(memory);
    memory.getSetting = async (k) => {
      await gate;
      return getSetting(k);
    };
    setIpc(memory);
    useAnalyticsStore.setState({ today: '2026-11-21', range: 'threeMonths' });
    render(<InsightsPage />);
    const card = await screen.findByRole('region', { name: 'Where your money went' });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(card).queryByRole('img', { name: /Spending map/ })).not.toBeInTheDocument();
    release();
    await waitFor(() => expect(card).toHaveTextContent('hidden: Restaurants'));
    expect(within(card).getByRole('group', { name: /Spending map/ })).toBeInTheDocument();
  });
});

describe('Insights spending map: speed', () => {
  it('reads transactions once and switches ranges from memory', async () => {
    const user = userEvent.setup();
    const card = await setup();
    await waitFor(() => expect(card).toHaveTextContent('$100.00'));
    const spy = vi.spyOn(ipc(), 'listTransactions');
    await user.click(screen.getByRole('radio', { name: '1Y' }));
    await waitFor(() => expect(card).toHaveTextContent('$300.00'));
    await user.click(screen.getByRole('radio', { name: 'All' }));
    await waitFor(() => expect(card).toHaveTextContent('$300.00'));
    // The other Insights cards still load their own data; the map asks for nothing.
    expect(spy.mock.calls.filter(([f]) => f.limit === undefined && f.from === undefined && f.to === undefined)).toHaveLength(0);
    expect(spy.mock.calls.filter(([f]) => f.limit === 1)).toHaveLength(0);
  });
});
