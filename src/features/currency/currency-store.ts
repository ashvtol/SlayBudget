import { create } from 'zustand';
import { ipc } from '@/lib/ipc';

export type FxBasis = 'transactionDate' | 'monthAverage' | 'latest';

export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD', 'AED', 'THB'];

const KEY_CURRENCY = 'display_currency';
const KEY_BASIS = 'fx_basis';

interface CurrencyState {
  displayCurrency: string;
  basis: FxBasis;
  loaded: boolean;
  load(): Promise<void>;
  setDisplayCurrency(code: string): Promise<void>;
  setBasis(basis: FxBasis): Promise<void>;
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  displayCurrency: 'USD',
  basis: 'transactionDate',
  loaded: false,
  async load() {
    const [currency, basis] = await Promise.all([ipc().getSetting(KEY_CURRENCY), ipc().getSetting(KEY_BASIS)]);
    set({
      displayCurrency: currency ?? 'USD',
      basis: (basis as FxBasis) ?? 'transactionDate',
      loaded: true,
    });
  },
  async setDisplayCurrency(code) {
    set({ displayCurrency: code });
    await ipc().setSetting(KEY_CURRENCY, code);
  },
  async setBasis(basis) {
    set({ basis });
    await ipc().setSetting(KEY_BASIS, basis);
  },
}));
