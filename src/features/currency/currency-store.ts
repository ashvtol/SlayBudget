import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTransactionsStore } from '@/features/transactions/transactions-store';

/** Month of each transaction (its month's average rate) or the latest month's rate for everything. */
export type FxBasis = 'monthAverage' | 'latest';

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

/** Everything on screen re-reads its amounts in the new currency. */
function showAgain() {
  useNavStore.getState().refresh();
  void useTransactionsStore.getState().refresh();
}

export const useCurrencyStore = create<CurrencyState>((set) => ({
  displayCurrency: 'USD',
  basis: 'monthAverage',
  loaded: false,
  async load() {
    const [currency, basis, base] = await Promise.all([ipc().getSetting(KEY_CURRENCY), ipc().getSetting(KEY_BASIS), ipc().getSetting('base_currency')]);
    set({
      displayCurrency: currency || base || 'USD',
      basis: basis === 'latest' ? 'latest' : 'monthAverage',
      loaded: true,
    });
  },
  async setDisplayCurrency(code) {
    set({ displayCurrency: code });
    await ipc().setSetting(KEY_CURRENCY, code);
    showAgain();
  },
  async setBasis(basis) {
    set({ basis });
    await ipc().setSetting(KEY_BASIS, basis);
    showAgain();
  },
}));

/** The currency amounts are shown in (for code outside React components). */
export const displayCurrency = () => useCurrencyStore.getState().displayCurrency;
