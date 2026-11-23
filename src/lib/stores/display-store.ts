import { create } from 'zustand';
import { ipc } from '../ipc';

const SIGNS_KEY = 'display.signs';
const ROLLING_KEY = 'display.rolling';

interface DisplayState {
  /** Settings > Accessibility: show - for money out and + for money in on transaction amounts. */
  signs: boolean;
  /** Settings > Accessibility: amounts that change roll digit by digit (never with Reduce motion). */
  rolling: boolean;
  load(): Promise<void>;
  setSigns(on: boolean): Promise<void>;
  setRolling(on: boolean): Promise<void>;
}

export const useDisplayStore = create<DisplayState>((set) => ({
  signs: false,
  rolling: true,
  async load() {
    const [signs, rolling] = await Promise.all([ipc().getSetting(SIGNS_KEY), ipc().getSetting(ROLLING_KEY)]);
    set({ signs: signs === '1', rolling: rolling !== '0' });
  },
  async setSigns(on) {
    set({ signs: on });
    await ipc().setSetting(SIGNS_KEY, on ? '1' : '0');
  },
  async setRolling(on) {
    set({ rolling: on });
    await ipc().setSetting(ROLLING_KEY, on ? '1' : '0');
  },
}));
