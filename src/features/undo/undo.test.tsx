import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';
import type { Transaction } from '@/lib/types';
import { UndoToast, menuStep, useUndoKeys } from './undo';
import { useUndoStore } from './undo-store';

const tx: Transaction = {
  id: 1, profileId: 1, sourceId: 1, postedOn: '2026-11-01', description: 'UBER', merchant: 'uber', amountCents: -1200, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null,
};
function Harness() {
  useUndoKeys();
  return (
    <>
      <input aria-label="Notes field" />
      <UndoToast />
    </>
  );
}
const category = async () => (await ipc().listTransactions({}))[0].categoryId;

afterEach(() => cleanup());
beforeEach(() => {
  setIpc(createMemoryIpc({ transactions: [{ ...tx }] }));
  useUndoStore.setState({ toast: null });
});

describe('undo and redo from the keyboard', () => {
  it('⌘Z undoes the latest change, says so, and refreshes the screen; ⇧⌘Z redoes it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ipc().setTransactionCategory(1, 11);
    const tick = useNavStore.getState().refreshTick;
    await user.keyboard('{Meta>}z{/Meta}');
    expect(await screen.findByRole('status')).toHaveTextContent('Undid Change Category');
    expect(await category()).toBeNull();
    expect(useNavStore.getState().refreshTick).toBe(tick + 1);
    await user.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Redid Change Category'));
    expect(await category()).toBe(11);
  });

  it('while typing in a field, ⌘Z is the field’s own undo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ipc().setTransactionCategory(1, 11);
    await user.click(screen.getByLabelText('Notes field'));
    await user.keyboard('{Meta>}z{/Meta}');
    expect(await category()).toBe(11);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('nothing to undo does nothing; a step that can’t apply says why', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Meta>}z{/Meta}');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.spyOn(ipc(), 'undo').mockRejectedValueOnce(new Error('Couldn’t undo “Change Category”: those rows changed since.'));
    await act(() => useUndoStore.getState().undo());
    expect(screen.getByRole('status')).toHaveTextContent('those rows changed since');
  });

  it('the Edit menu undoes too, but not a second time for the same ⌘Z the page already took', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await ipc().setTransactionCategory(1, 11);
    await ipc().setTransactionCategory(1, 12);
    await user.keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Undid'));
    menuStep('undo');
    await act(async () => {});
    expect(await category()).toBe(11);
    menuStep('undo', performance.now() + 1000);
    await waitFor(async () => expect(await category()).toBeNull());
  });
});
