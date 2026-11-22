import { act } from '@testing-library/react';
import { createMemoryIpc, setIpc } from '../ipc';
import { THEMES, useThemeStore } from './theme-store';

describe('theme store', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({ theme: 'navy', loaded: false });
  });

  it('defaults to navy and applies it to the document', async () => {
    setIpc(createMemoryIpc());
    await act(() => useThemeStore.getState().load());
    expect(useThemeStore.getState().theme).toBe('navy');
    expect(document.documentElement.dataset.theme).toBe('navy');
  });

  it('loads a saved theme', async () => {
    const ipc = createMemoryIpc();
    await ipc.setSetting('theme', 'daylight');
    setIpc(ipc);
    await act(() => useThemeStore.getState().load());
    expect(useThemeStore.getState().theme).toBe('daylight');
    expect(document.documentElement.dataset.theme).toBe('daylight');
  });

  it('persists a change and updates the document', async () => {
    const ipc = createMemoryIpc();
    setIpc(ipc);
    await act(() => useThemeStore.getState().setTheme('graphite'));
    expect(document.documentElement.dataset.theme).toBe('graphite');
    expect(await ipc.getSetting('theme')).toBe('graphite');
  });

  it('ignores unknown theme names from storage', async () => {
    const ipc = createMemoryIpc();
    await ipc.setSetting('theme', 'neon');
    setIpc(ipc);
    await act(() => useThemeStore.getState().load());
    expect(useThemeStore.getState().theme).toBe('navy');
  });

  it('exposes the themes, plus System', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['navy', 'graphite', 'daylight', 'aurora', 'system']);
  });
});

describe('System theme (follows macOS light/dark)', () => {
  let dark = true;
  const listeners: ((e: { matches: boolean }) => void)[] = [];
  beforeEach(() => {
    dark = true;
    listeners.length = 0;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query.includes('dark') ? dark : false;
      },
      media: query,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
    })) as unknown as typeof window.matchMedia;
    document.documentElement.removeAttribute('data-theme');
    useThemeStore.setState({ theme: 'navy', loaded: false });
  });

  it('is offered as a theme', () => {
    expect(THEMES.map((t) => t.id)).toContain('system');
  });

  it('uses Navy while the Mac is dark and Daylight when it turns light', async () => {
    setIpc(createMemoryIpc());
    await act(() => useThemeStore.getState().setTheme('system'));
    expect(document.documentElement.dataset.theme).toBe('navy');
    dark = false;
    act(() => listeners.forEach((fn) => fn({ matches: false })));
    expect(document.documentElement.dataset.theme).toBe('daylight');
    expect(useThemeStore.getState().theme).toBe('system');
  });

  it('stops following the Mac once another theme is picked', async () => {
    setIpc(createMemoryIpc());
    await act(() => useThemeStore.getState().setTheme('system'));
    await act(() => useThemeStore.getState().setTheme('aurora'));
    dark = false;
    act(() => listeners.forEach((fn) => fn({ matches: false })));
    expect(document.documentElement.dataset.theme).toBe('aurora');
  });
});
