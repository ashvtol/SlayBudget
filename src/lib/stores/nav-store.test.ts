import { beforeEach, describe, expect, it } from 'vitest';
import { useNavStore } from './nav-store';

describe('nav store', () => {
  beforeEach(() => useNavStore.setState({ section: 'transactions', settingsOpen: false }));

  it('opens Settings over the current screen instead of leaving it', () => {
    useNavStore.getState().go('settings');
    expect(useNavStore.getState()).toMatchObject({ section: 'transactions', settingsOpen: true });
  });

  it('closes Settings', () => {
    useNavStore.getState().go('settings');
    useNavStore.getState().closeSettings();
    expect(useNavStore.getState().settingsOpen).toBe(false);
  });

  it('going to another screen closes Settings', () => {
    useNavStore.getState().go('settings');
    useNavStore.getState().go('cashflow');
    expect(useNavStore.getState()).toMatchObject({ section: 'cashflow', settingsOpen: false });
  });
});

describe('nav store settings pane', () => {
  beforeEach(() => useNavStore.setState({ section: 'transactions', settingsOpen: false, settingsPane: null }));

  it('opens Settings straight at a pane, keeping the screen', () => {
    useNavStore.getState().openSettingsPane('tags');
    expect(useNavStore.getState()).toMatchObject({ section: 'transactions', settingsOpen: true, settingsPane: 'tags' });
  });

  it('closing Settings forgets the pane', () => {
    useNavStore.getState().openSettingsPane('tags');
    useNavStore.getState().closeSettings();
    expect(useNavStore.getState().settingsPane).toBeNull();
  });
});

describe('nav store history (Copilot back/forward)', () => {
  beforeEach(() => useNavStore.setState({ section: 'dashboard', settingsOpen: false, back: [], forward: [] }));

  it('goes back and forward through screens', () => {
    const s = useNavStore.getState();
    s.go('transactions');
    s.go('categories');
    expect(useNavStore.getState().canGoBack()).toBe(true);
    useNavStore.getState().goBack();
    expect(useNavStore.getState().section).toBe('transactions');
    useNavStore.getState().goBack();
    expect(useNavStore.getState().section).toBe('dashboard');
    expect(useNavStore.getState().canGoBack()).toBe(false);
    useNavStore.getState().goForward();
    expect(useNavStore.getState().section).toBe('transactions');
    expect(useNavStore.getState().canGoForward()).toBe(true);
  });

  it('drops the forward steps when going somewhere new, and ignores going to the same screen', () => {
    const s = useNavStore.getState();
    s.go('transactions');
    s.go('categories');
    useNavStore.getState().goBack();
    useNavStore.getState().go('insights');
    expect(useNavStore.getState().canGoForward()).toBe(false);
    useNavStore.getState().go('insights');
    useNavStore.getState().goBack();
    expect(useNavStore.getState().section).toBe('transactions');
  });

  it('keeps the last 50 screens, and opening Settings is not a step', () => {
    for (let i = 0; i < 60; i++) useNavStore.getState().go(i % 2 ? 'transactions' : 'categories');
    expect(useNavStore.getState().back.length).toBe(50);
    const before = useNavStore.getState().back.length;
    useNavStore.getState().go('settings');
    expect(useNavStore.getState().back.length).toBe(before);
  });

  it('counts refreshes', () => {
    const before = useNavStore.getState().refreshTick;
    useNavStore.getState().refresh();
    expect(useNavStore.getState().refreshTick).toBe(before + 1);
  });
});
