import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';
import { useTagsStore } from '@/lib/stores/tags-store';
import type { Transaction } from '@/lib/types';
import { TagPicker } from './tag-picker';
import { useTransactionsStore } from './transactions-store';

afterEach(() => cleanup());

const tx = (id: number, tagIds: number[]): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn: '2026-11-01', description: `ROW ${id}`, merchant: `row ${id}`, amountCents: -100, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, tagIds,
});

async function setup(ids: number[]) {
  setIpc(createMemoryIpc({ tags: [{ id: 1, name: 'Work', color: '#4a8ef0' }, { id: 2, name: 'Trip', color: '#e5484d' }], transactions: [tx(1, [1]), tx(2, [])] }));
  useTransactionsStore.setState({ transactions: [], filter: {}, selected: new Set() });
  useNavStore.setState({ settingsOpen: false, settingsPane: null });
  await useTransactionsStore.getState().load(null);
  let closed = false;
  render(<TagPicker ids={ids} onClose={() => (closed = true)} />);
  return { picker: screen.getByRole('dialog', { name: 'Tags' }), closed: () => closed };
}

describe('TagPicker', () => {
  beforeEach(() => useTagsStore.setState({ tags: [], byId: {} }));

  it('lists tags with their state for one row, and searches them', async () => {
    const user = userEvent.setup();
    const { picker } = await setup([1]);
    expect(within(picker).getByRole('checkbox', { name: 'Work' })).toHaveAttribute('aria-checked', 'true');
    expect(within(picker).getByRole('checkbox', { name: 'Trip' })).toHaveAttribute('aria-checked', 'false');
    await user.type(within(picker).getByRole('textbox', { name: 'Add tags' }), 'tri');
    expect(within(picker).queryByRole('checkbox', { name: 'Work' })).not.toBeInTheDocument();
  });

  it('ticks and unticks at once', async () => {
    const user = userEvent.setup();
    const { picker } = await setup([1]);
    await user.click(within(picker).getByRole('checkbox', { name: 'Work' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(1)?.tagIds).toEqual([]));
    await user.click(within(picker).getByRole('checkbox', { name: 'Trip' }));
    await waitFor(() => expect(useTransactionsStore.getState().byId(1)?.tagIds).toEqual([2]));
  });

  it('offers to create a tag that does not exist, and Enter does it', async () => {
    const user = userEvent.setup();
    const { picker } = await setup([2]);
    const field = within(picker).getByRole('textbox', { name: 'Add tags' });
    await user.type(field, 'work');
    expect(within(picker).queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
    await user.clear(field);
    await user.type(field, 'Gift{Enter}');
    await waitFor(() => expect(within(picker).getByRole('checkbox', { name: 'Gift' })).toHaveAttribute('aria-checked', 'true'));
    expect(useTransactionsStore.getState().byId(2)?.tagIds).toHaveLength(1);
    expect(field).toHaveValue('');
  });

  it('creates from the Create row too', async () => {
    const user = userEvent.setup();
    const { picker } = await setup([2]);
    await user.type(within(picker).getByRole('textbox', { name: 'Add tags' }), 'Japan');
    await user.click(within(picker).getByRole('button', { name: 'Create “Japan”' }));
    await waitFor(() => expect(useTagsStore.getState().tags.map((t) => t.name)).toContain('Japan'));
  });

  it('opens tag settings from the footer and closes', async () => {
    const user = userEvent.setup();
    const { picker, closed } = await setup([1]);
    await user.click(within(picker).getByRole('button', { name: 'View tag settings' }));
    expect(useNavStore.getState()).toMatchObject({ settingsOpen: true, settingsPane: 'tags' });
    expect(closed()).toBe(true);
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const { closed } = await setup([1]);
    await user.keyboard('{Escape}');
    expect(closed()).toBe(true);
  });
});
