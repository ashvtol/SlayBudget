import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { RolloversPane } from './rollovers-pane';

afterEach(() => cleanup());

describe('RolloversPane', () => {
  it('turns rollovers on and off (off by default)', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    render(<RolloversPane />);
    const toggle = await screen.findByRole('switch', { name: 'Enable rollover' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByText(/carries into the next month/)).toBeInTheDocument();
    await user.click(toggle);
    await waitFor(async () => expect(await ipc().getSetting('budgets.rollovers')).toBe('1'));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.click(toggle);
    await waitFor(async () => expect(await ipc().getSetting('budgets.rollovers')).toBe('0'));
  });
});
