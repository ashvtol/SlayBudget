import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNavStore } from '@/lib/stores/nav-store';
import { openTarget } from './route';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** A screen with a scrolling page and the tips 900px down it; jsdom has no layout, so positions are stubbed. */
function insightsScreen({ inert }: { inert: boolean }) {
  const screen = document.createElement('div');
  if (inert) screen.setAttribute('inert', '');
  const page = document.createElement('div');
  page.style.overflowY = 'auto';
  page.getBoundingClientRect = () => ({ top: 60 }) as DOMRect;
  const tips = document.createElement('section');
  tips.setAttribute('aria-label', 'Tips for you');
  tips.getBoundingClientRect = () => ({ top: 960 - page.scrollTop }) as DOMRect;
  tips.scrollIntoView = vi.fn();
  page.append(tips);
  screen.append(page);
  document.body.append(screen);
  return { screen, page, tips };
}

describe('openTarget', () => {
  it('opens Insights and scrolls only the page to the tips, never the window around it', async () => {
    useNavStore.setState({ section: 'dashboard', settingsOpen: true });
    const { page, tips } = insightsScreen({ inert: false });
    await openTarget({ kind: 'insights' });
    expect(useNavStore.getState().section).toBe('insights');
    expect(useNavStore.getState().settingsOpen).toBe(false);
    expect(page.scrollTop).toBe(900 - 16);
    expect(tips.scrollIntoView).not.toHaveBeenCalled();
  });

  it('waits until Insights is showing (a hidden screen is inert), and scrolls again once its data has settled', async () => {
    useNavStore.setState({ section: 'dashboard', settingsOpen: false });
    const { screen, page } = insightsScreen({ inert: true });
    const done = openTarget({ kind: 'insights' });
    await new Promise((r) => setTimeout(r, 120));
    expect(page.scrollTop).toBe(0);
    screen.removeAttribute('inert');
    await done;
    expect(page.scrollTop).toBe(884);
    page.scrollTop = 100; // the page above grew or shrank as it re-read its data
    await vi.waitFor(() => expect(page.scrollTop).toBe(884), { timeout: 1500 });
  });
});
