import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { CategorizationPane } from './categorization-pane';

afterEach(() => cleanup());

describe('CategorizationPane', () => {
  it('turns automatic categorizing off and on', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({}));
    render(<CategorizationPane />);
    const sw = await screen.findByRole('switch', { name: 'Automatically categorize when confident' });
    expect(sw).toBeChecked();
    await user.click(sw);
    await waitFor(async () => expect(await ipc().getSetting('auto_categorize')).toBe('0'));
    await user.click(sw);
    await waitFor(async () => expect(await ipc().getSetting('auto_categorize')).toBe('1'));
  });

  it('sets how many days apart a transfer’s two sides may be', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({}));
    render(<CategorizationPane />);
    const days = await screen.findByRole('combobox', { name: 'Transfer days apart' });
    expect(days).toHaveValue('4');
    await user.selectOptions(days, '7');
    await waitFor(async () => expect(await ipc().getSetting('transfer_window_days')).toBe('7'));
  });

  it('resets what SlayBudget learned only after you confirm', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({}));
    const reset = vi.spyOn(ipc(), 'resetLearning');
    render(<CategorizationPane />);
    await user.click(await screen.findByRole('button', { name: 'Reset what SlayBudget learned…' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Reset what SlayBudget learned…' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent('SlayBudget forgot what it learned.');
  });
});
