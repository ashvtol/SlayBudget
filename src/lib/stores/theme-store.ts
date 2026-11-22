import { create } from 'zustand';
import { ipc } from '../ipc';

export const THEMES = [
  { id: 'navy', name: 'Navy', description: 'Dark navy, blue accent' },
  { id: 'graphite', name: 'Graphite', description: 'Neutral black, white accent' },
  { id: 'daylight', name: 'Daylight', description: 'Light, deep blue accent' },
  { id: 'aurora', name: 'Aurora', description: 'Dark violet, teal accent' },
  { id: 'system', name: 'System', description: 'Navy when the Mac is dark, Daylight when light' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'navy';

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

// "System" follows macOS: the theme is re-resolved whenever the Mac switches light/dark.
let stopFollowing: (() => void) | null = null;

function systemTheme(): 'navy' | 'daylight' {
  const dark = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
  return dark ? 'navy' : 'daylight';
}

function applyToDocument(theme: ThemeId): void {
  stopFollowing?.();
  stopFollowing = null;
  if (theme !== 'system') {
    document.documentElement.dataset.theme = theme;
    return;
  }
  document.documentElement.dataset.theme = systemTheme();
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    document.documentElement.dataset.theme = systemTheme();
  };
  query.addEventListener('change', onChange);
  stopFollowing = () => query.removeEventListener('change', onChange);
}

interface ThemeState {
  theme: ThemeId;
  loaded: boolean;
  load(): Promise<void>;
  setTheme(theme: ThemeId): Promise<void>;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: DEFAULT_THEME,
  loaded: false,
  async load() {
    const saved = await ipc().getSetting('theme');
    const theme = isThemeId(saved) ? saved : DEFAULT_THEME;
    applyToDocument(theme);
    set({ theme, loaded: true });
  },
  async setTheme(theme) {
    applyToDocument(theme);
    set({ theme });
    await ipc().setSetting('theme', theme);
  },
}));
