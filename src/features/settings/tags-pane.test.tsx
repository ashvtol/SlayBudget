import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryIpc, NEW_TAG_ORDER, setIpc, TAG_PALETTE } from '@/lib/ipc';
import { useTagsStore } from '@/lib/stores/tags-store';
import type { Transaction } from '@/lib/types';
import { TagsPane } from './tags-pane';

afterEach(() => cleanup());

const tx = (id: number, tagIds: number[]): Transaction => ({
  id, profileId: 1, sourceId: 1, postedOn: '2026-11-01', description: `ROW ${id}`, merchant: `row ${id}`, amountCents: -100, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null, tagIds,
});

async function renderPane() {
  setIpc(createMemoryIpc({ tags: [{ id: 1, name: 'Work', color: '#4a8ef0' }, { id: 2, name: 'Trip', color: '#e5484d' }], transactions: [tx(1, [1]), tx(2, [1])] }));
  useTagsStore.setState({ tags: [], byId: {} });
  render(<TagsPane />);
  await screen.findByRole('textbox', { name: 'Tag name Work' });
}

describe('TagsPane', () => {
  beforeEach(() => useTagsStore.setState({ tags: [], byId: {} }));

  it('explains tags and lists them in creation order', async () => {
    await renderPane();
    expect(screen.getByText(/categorize your transactions more granularly/)).toBeInTheDocument();
    expect(screen.getAllByRole('textbox').map((t) => (t as HTMLInputElement).value)).toEqual(['Work', 'Trip']);
  });

  it('adds a new tag and focuses its name', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    const field = await screen.findByRole('textbox', { name: 'Tag name New tag' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(useTagsStore.getState().tags.at(-1)?.color).toBe(TAG_PALETTE[NEW_TAG_ORDER[2]]);
    // After naming it, Enter saves and lets go of the field (it does not grab focus again).
    await user.clear(field);
    await user.type(field, 'Gift{Enter}');
    const renamed = await screen.findByRole('textbox', { name: 'Tag name Gift' });
    expect(renamed).not.toHaveFocus();
  });

  it('renames on Enter', async () => {
    const user = userEvent.setup();
    await renderPane();
    const field = screen.getByRole('textbox', { name: 'Tag name Trip' });
    await user.clear(field);
    await user.type(field, 'Japan trip{Enter}');
    await waitFor(() => expect(useTagsStore.getState().byId[2]?.name).toBe('Japan trip'));
  });

  it('refuses a duplicate name, says why, and puts the old name back', async () => {
    const user = userEvent.setup();
    await renderPane();
    const field = screen.getByRole('textbox', { name: 'Tag name Trip' });
    await user.clear(field);
    await user.type(field, 'work');
    await user.tab();
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/);
    expect(field).toHaveValue('Trip');
  });

  it('recolors from the palette', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Color for Work' }));
    const palette = screen.getByRole('listbox', { name: 'Colors' });
    expect(within(palette).getAllByRole('option')).toHaveLength(TAG_PALETTE.length);
    await user.click(within(palette).getAllByRole('option')[7]);
    await waitFor(() => expect(useTagsStore.getState().byId[1]?.color).toBe(TAG_PALETTE[7]));
    expect(screen.queryByRole('listbox', { name: 'Colors' })).not.toBeInTheDocument();
  });

  it('asks before deleting a tag in use, saying how many transactions lose it', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Delete Work' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Work?' });
    expect(dialog).toHaveTextContent('It will be removed from 2 transactions.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(useTagsStore.getState().byId[1]).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Delete Work' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useTagsStore.getState().byId[1]).toBeUndefined());
  });

  it('deletes an unused tag without asking', async () => {
    const user = userEvent.setup();
    await renderPane();
    await user.click(screen.getByRole('button', { name: 'Delete Trip' }));
    await waitFor(() => expect(useTagsStore.getState().byId[2]).toBeUndefined());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
