import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

const rates = vi.hoisted(() => ({ syncRates: vi.fn(async () => 0) }));
vi.mock('./rates', () => rates);
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useCurrencyStore } from './currency-store';
import { CurrencyPane } from './currency-pane';

afterEach(() => cleanup());

async function renderPane() {
  setIpc(createMemoryIpc());
  useCurrencyStore.setState({ displayCurrency: 'USD', basis: 'transactionDate', loaded: false });
  render(<CurrencyPane />);
  await waitFor(() => expect(useCurrencyStore.getState().loaded).toBe(true));
}

describe('CurrencyPane', () => {
  it('persists the chosen display currency and enables the basis options', async () => {
    const user = userEvent.setup();
    await renderPane();
    // basis disabled while display currency matches statement currency
    expect(screen.getByRole('radio', { name: /Transaction date/ })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'INR');
    await waitFor(() => expect(ipc().getSetting('display_currency')).resolves.toBe('INR'));
    expect(screen.getByRole('radio', { name: /Transaction date/ })).toBeEnabled();
  });

  it('saves the conversion basis', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'EUR');
    await user.click(screen.getByRole('radio', { name: /Monthly average/ }));
    await waitFor(() => expect(ipc().getSetting('fx_basis')).resolves.toBe('monthAverage'));
  });
});

describe('CurrencyPane rate range', () => {
  it("asks for rates up to today's local date, even late in the evening", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 21, 23, 30)); // already the 22nd in UTC west of Greenwich
    const user = userEvent.setup();
    await renderPane();
    await user.selectOptions(screen.getByLabelText('Display currency'), 'EUR');
    await user.click(screen.getByRole('button', { name: /rates/i }));
    await waitFor(() => expect(rates.syncRates).toHaveBeenCalled());
    expect(rates.syncRates).toHaveBeenCalledWith('USD', 'EUR', '2025-11-21', '2026-11-21');
    vi.useRealTimers();
  });
});
