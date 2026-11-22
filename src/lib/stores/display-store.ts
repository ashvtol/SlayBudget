import { create } from 'zustand';
import { ipc } from '../ipc';

const SIGNS_KEY = 'display.signs';

interface DisplayState {
  /** Settings > Accessibility: show - for money out and + for money in on transaction amounts. */
  signs: boolean;
  load(): Promise<void>;
  setSigns(on: boolean): Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set) => ({
  signs: false,
  async load() {
    set({ signs: (await ipc().getSetting(SIGNS_KEY)) === '1' });
  },
  async setSigns(on) {
    set({ signs: on });
    await ipc().setSetting(SIGNS_KEY, on ? '1' : '0');
  },
}));
