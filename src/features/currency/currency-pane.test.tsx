import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
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
