import { vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './app';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useTransactionsStore } from '@/features/transactions/transactions-store';
import { useNavStore } from '@/lib/stores/nav-store';
import { useThemeStore } from '@/lib/stores/theme-store';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 44 })),
    measureElement: () => {},
  }),
}));

beforeEach(() => {
  setIpc(createMemoryIpc());
  useNavStore.setState({ section: 'dashboard', settingsOpen: false });
  useThemeStore.setState({ theme: 'navy', loaded: false });
});

describe('App shell', () => {
  it('shows the sidebar sections and the dashboard by default', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: /sections/i });
    for (const name of ['Dashboard', 'Transactions', 'Cash flow', 'Categories', 'Recurring', 'Insights', 'Import', 'Settings']) {
      expect(nav).toHaveTextContent(name);
    }
    expect(await screen.findByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('opens Settings as a panel over the current screen and switches theme', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    const settings = await screen.findByRole('dialog', { name: 'Settings' });
    expect(screen.getByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    await user.click(within(settings).getByRole('button', { name: /Theme/ }));
    await user.click(within(settings).getByRole('radio', { name: /aurora/i }));
    expect(document.documentElement.dataset.theme).toBe('aurora');
    expect(within(settings).getByRole('radio', { name: /aurora/i })).toBeChecked();
    await user.click(within(settings).getByRole('button', { name: 'Back to Settings' }));
    expect(within(settings).getByRole('button', { name: /Theme.*Aurora/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('supports Cmd+number shortcuts for sections', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('{Meta>}2{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
  });

  it('opens Settings with Cmd+comma', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('{Meta>},{/Meta}');
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });
});

describe('Keeping views when switching screens', () => {
  const seed = () =>
    createMemoryIpc({
      transactions: [
        { id: 1, profileId: 1, sourceId: 1, postedOn: '2026-11-15', description: 'WHOLE FOODS', merchant: 'whole foods', amountCents: -6418, currency: 'USD', categoryId: 10, categoryLocked: false, reviewed: true, notes: null, refundOf: null },
        { id: 2, profileId: 1, sourceId: 1, postedOn: '2026-11-10', description: 'SHELL OIL', merchant: 'shell', amountCents: -4800, currency: 'USD', categoryId: 20, categoryLocked: false, reviewed: false, notes: null, refundOf: null },
      ],
    });
  const go = (s: Parameters<ReturnType<typeof useNavStore.getState>['go']>[0]) => act(() => useNavStore.getState().go(s));

  it('keeps the selected category after visiting another screen', async () => {
    const user = userEvent.setup();
    setIpc(seed());
    render(<App />);
    go('categories');
    const tree = await screen.findByRole('grid', { name: 'Categories' });
    await user.click(within(tree).getByRole('row', { name: /Fuel/ }));
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'Fuel' })).toBeInTheDocument();
    go('dashboard');
    go('categories');
    expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'Fuel' })).toBeInTheDocument();
  });

  it('keeps the open transaction, and turns its shortcuts off while hidden', async () => {
    const user = userEvent.setup();
    setIpc(seed());
    useTransactionsStore.setState({ transactions: [], filter: {}, selected: new Set(), cursor: 0 });
    render(<App />);
    go('transactions');
    await user.click(await within(await screen.findByRole('grid', { name: 'Transactions' })).findByText('Shell'));
    go('cashflow');
    await user.keyboard('x');
    expect(useTransactionsStore.getState().selected.size).toBe(0);
    go('transactions');
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Details' })).getByRole('heading', { name: 'Shell' })).toBeInTheDocument());
  });

  it('hides inactive screens from assistive tech and the pointer', async () => {
    setIpc(seed());
    render(<App />);
    go('transactions');
    await screen.findByRole('heading', { level: 1, name: 'All transactions' });
    go('dashboard');
    const hidden = document.querySelector('[data-screen="transactions"]') as HTMLElement;
    expect(hidden).toHaveAttribute('inert');
    expect(hidden).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows edits made elsewhere when coming back', async () => {
    setIpc(seed());
    useTransactionsStore.setState({ transactions: [], filter: {}, selected: new Set(), cursor: 0 });
    render(<App />);
    go('transactions');
    await within(await screen.findByRole('grid', { name: 'Transactions' })).findByText('Shell');
    go('categories');
    await act(() => ipc().updateCategory(20, { name: 'Petrol' }));
    go('transactions');
    expect(await within(screen.getByRole('grid', { name: 'Transactions' })).findByText(/Petrol/i)).toBeInTheDocument();
  });
});

describe('App shell Mac details', () => {
  beforeEach(() => useNavStore.setState({ section: 'dashboard', settingsOpen: false, back: [], forward: [] }));

  it('goes back and forward with the arrows and with Cmd+[ / Cmd+]', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.keyboard('{Meta>}2{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await user.keyboard('{Meta>}]{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
    await user.keyboard('{Meta>}[[{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: /dashboard/i })).toBeInTheDocument();
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: /transactions/i })).toBeInTheDocument();
  });

  it('refreshes the current screen with Cmd+R and the refresh button', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: /dashboard/i });
    const before = useNavStore.getState().refreshTick;
    await user.keyboard('{Meta>}r{/Meta}');
    expect(useNavStore.getState().refreshTick).toBe(before + 1);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(useNavStore.getState().refreshTick).toBe(before + 2);
  });
});
