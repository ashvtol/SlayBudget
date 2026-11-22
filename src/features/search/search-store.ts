import { create } from 'zustand';
import { ipc } from '@/lib/ipc';
import { todayStr } from '@/features/analytics/analytics-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Transaction } from '@/lib/types';

interface SearchState {
  open: boolean;
  query: string;
  results: Transaction[];
  loading: boolean;
  openPalette(): void;
  closePalette(): void;
  setQuery(q: string): void;
  run(): Promise<void>;
}

let seq = 0;

export const useSearchStore = create<SearchState>((set, get) => ({
  open: false,
  query: '',
  results: [],
  loading: false,
  openPalette() {
    set({ open: true });
  },
  closePalette() {
    set({ open: false });
  },
  setQuery(q) {
    set({ query: q });
    void get().run();
  },
  async run() {
    const { query } = get();
    if (query.trim() === '') {
      set({ results: [], loading: false });
      return;
    }
    const mine = ++seq;
    set({ loading: true });
    const profileId = useProfileStore.getState().activeProfileId;
    const results = await ipc().searchTransactions(profileId, query, todayStr(), 100);
    if (mine === seq) set({ results, loading: false });
  },
}));
