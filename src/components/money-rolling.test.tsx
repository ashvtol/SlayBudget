import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useDisplayStore } from '@/lib/stores/display-store';
import { AccessibilityPane } from '@/features/settings/accessibility-pane';
import { Money } from './money';

const reduceMotion = (on: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: on && q.includes('reduce'), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }) as MediaQueryList);

beforeEach(() => {
  useDisplayStore.setState({ rolling: true });
  reduceMotion(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('rolling numbers', () => {
  it('a rolling digit sits exactly where a plain digit does, so nothing jumps when the roll ends', async () => {
    // jsdom can't lay text out, so this pins the CSS that keeps rolling digits on the text's own line: the slot clips
    // with clip-path (an overflow-hidden inline-block moves its baseline to its bottom edge) and keeps the line height.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync('src/app/styles.css', 'utf8');
    const slot = /\.roll-slot\s*\{([^}]*)\}/.exec(css)![1];
    expect(slot).toMatch(/clip-path:\s*inset\(0/);
    expect(slot).not.toMatch(/overflow:\s*hidden/);
    expect(slot).not.toMatch(/line-height/);
    expect(slot).not.toMatch(/vertical-align/);
  });

  it('rolls only the digits that changed: the old one goes up and out, the new one comes in from below', () => {
    const { rerender, container } = render(<Money cents={12345} currency="USD" />);
    expect(container.querySelectorAll('[data-roll]')).toHaveLength(0);
    rerender(<Money cents={12395} currency="USD" />);
    const rolling = container.querySelectorAll('[data-roll]');
    expect(rolling).toHaveLength(1);
    expect(rolling[0].querySelector('[data-roll-out]')).toHaveTextContent('4');
    expect(rolling[0].querySelector('[data-roll-in]')).toHaveTextContent('9');
    // Screen readers hear the amount once, as it is now.
    expect(screen.getByLabelText('$123.95')).toBeInTheDocument();
  });

  it('digits further left start a little later, like a ticker', () => {
    const { rerender, container } = render(<Money cents={11111} currency="USD" />);
    rerender(<Money cents={22222} currency="USD" />);
    const delays = [...container.querySelectorAll<HTMLElement>('[data-roll]')].map((el) => parseFloat(el.style.getPropertyValue('--roll-delay')));
    expect(delays.length).toBe(5);
    expect(delays).toEqual([...delays].sort((a, b) => b - a));
  });

  it('stays still with the setting off, or when macOS asks to reduce motion', () => {
    useDisplayStore.setState({ rolling: false });
    const a = render(<Money cents={100} currency="USD" />);
    a.rerender(<Money cents={900} currency="USD" />);
    expect(a.container.querySelectorAll('[data-roll]')).toHaveLength(0);
    cleanup();
    useDisplayStore.setState({ rolling: true });
    vi.restoreAllMocks();
    reduceMotion(true);
    const b = render(<Money cents={100} currency="USD" />);
    b.rerender(<Money cents={900} currency="USD" />);
    expect(b.container.querySelectorAll('[data-roll]')).toHaveLength(0);
  });

  it('stays still when told to (a chart header following the pointer must change at once)', () => {
    const { rerender, container } = render(<Money cents={123456} currency="USD" still />);
    rerender(<Money cents={128756} currency="USD" still />);
    expect(container.querySelectorAll('[data-roll]')).toHaveLength(0);
    expect(container.textContent).toBe('$1,287.56');
  });

  it('can be turned off in Settings > Accessibility', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    render(<AccessibilityPane />);
    const toggle = screen.getByRole('switch', { name: 'Animate changing numbers' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(useDisplayStore.getState().rolling).toBe(false);
    expect(await ipc().getSetting('display.rolling')).toBe('0');
  });
});
