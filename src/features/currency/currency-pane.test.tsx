import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { builtinRates } from '@/lib/fx';
import { useNavStore } from '@/lib/stores/nav-store';
import { useCurrencyStore } from './currency-store';
import { CurrencyPane } from './currency-pane';

afterEach(() => cleanup());

async function renderPane() {
  setIpc(createMemoryIpc());
  useCurrencyStore.setState({ displayCurrency: 'USD', basis: 'monthAverage', loaded: false });
  render(<CurrencyPane />);
  await waitFor(() => expect(useCurrencyStore.getState().loaded).toBe(true));
}

describe('CurrencyPane', () => {
  it('offers every built-in currency, saves the choice and refreshes what you see', async () => {
    const user = userEvent.setup();
    await renderPane();
    const select = screen.getByRole('combobox', { name: 'Display currency' });
    await waitFor(() => expect(select.querySelectorAll('option').length).toBe(builtinRates().currencies().length));
    expect(screen.getByRole('radio', { name: /Month of each transaction/ })).toBeDisabled();
    const tick = useNavStore.getState().refreshTick;
    await user.selectOptions(select, 'INR');
    await waitFor(() => expect(ipc().getSetting('display_currency')).resolves.toBe('INR'));
    expect(useNavStore.getState().refreshTick).toBeGreaterThan(tick);
    expect(screen.getByRole('radio', { name: /Month of each transaction/ })).toBeEnabled();
  });

  it('has two bases, month of each transaction and latest rates', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Display currency' }), 'EUR');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    await user.click(screen.getByRole('radio', { name: /Latest rates/ }));
    await waitFor(() => expect(ipc().getSetting('fx_basis')).resolves.toBe('latest'));
  });

  it('says how recent the built-in rates are, and never fetches any', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await renderPane();
    const month = new Date(`${builtinRates().latestMonth()}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    expect(await screen.findByText(new RegExp(`Rates through ${month}`))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Update rates/ })).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
