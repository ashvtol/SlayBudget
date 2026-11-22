import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useDisplayStore } from '@/lib/stores/display-store';
import { AccessibilityPane } from './accessibility-pane';

afterEach(() => cleanup());

describe('AccessibilityPane', () => {
  it('turns +/- signs on amounts on and off, saving the choice', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    useDisplayStore.setState({ signs: false });
    render(<AccessibilityPane />);
    const toggle = screen.getByRole('switch', { name: '+/- signs on amounts' });
    await user.click(toggle);
    expect(useDisplayStore.getState().signs).toBe(true);
    await waitFor(async () => expect(await ipc().getSetting('display.signs')).toBe('1'));
  });

  it('loads the saved choice', async () => {
    const m = createMemoryIpc({ settings: { 'display.signs': '1' } });
    setIpc(m);
    useDisplayStore.setState({ signs: false });
    await useDisplayStore.getState().load();
    expect(useDisplayStore.getState().signs).toBe(true);
  });
});
