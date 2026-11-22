import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import type { CategoryGroup } from '@/lib/types';
import { AddCategoryMenu } from './add-category-menu';
import { PALETTE } from './palette';
import { TEMPLATES } from './templates';

afterEach(() => cleanup());

const groups: CategoryGroup[] = [
  { id: 1, name: 'Food & Drink', emoji: '🍔', color: '#e8743b', sortOrder: 0 },
  { id: 2, name: 'Transportation', emoji: '🚗', color: '#e8c34f', sortOrder: 1 },
];

let onCreated: ReturnType<typeof vi.fn<(id: number) => void>>;
beforeEach(() => {
  setIpc(createMemoryIpc({ groups: groups.map((g) => ({ ...g })), categories: [] }));
  onCreated = vi.fn<(id: number) => void>();
});

const renderMenu = (existingNames: string[] = ['Groceries', 'Coffee']) =>
  render(<AddCategoryMenu groups={groups} existingNames={existingNames} onCreated={onCreated} />);

describe('palette and templates', () => {
  it('offers 15 colors and the Copilot-style template list', () => {
    expect(PALETTE).toHaveLength(15);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(25);
    expect(TEMPLATES.every((t) => t.name && t.emoji && PALETTE.includes(t.color))).toBe(true);
  });
});

describe('AddCategoryMenu', () => {
  it('opens a menu with Start from scratch and templates, hiding ones that already exist', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    const menu = screen.getByRole('menu', { name: 'Add category' });
    expect(within(menu).getByRole('menuitem', { name: 'Start from scratch' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Pets/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Coffee/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Groceries/ })).not.toBeInTheDocument();
  });

  it('creates a template category immediately, top-level, with its emoji and color and no budget', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc(), 'createCategory');
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: /Pets/ }));
    const pets = TEMPLATES.find((t) => t.name === 'Pets')!;
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pets', emoji: pets.emoji, color: pets.color, groupTarget: 'own' }));
    expect(spy.mock.calls[0][0].budgetCents ?? null).toBeNull();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.any(Number)));
  });

  it('the from-scratch form has type, emoji, name, budget, 15 colors and a group', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    const form = screen.getByRole('dialog', { name: 'New category' });
    expect(within(form).getByRole('radio', { name: 'Regular' })).toBeChecked();
    expect(within(form).getByRole('radio', { name: 'Excluded' })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: /Choose emoji/ })).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Category name' })).toBeInTheDocument();
    expect(within(form).getByRole('textbox', { name: 'Budget' })).toHaveValue('');
    expect(within(within(form).getByRole('radiogroup', { name: 'Color' })).getAllByRole('radio')).toHaveLength(15);
    expect(within(form).getByRole('combobox', { name: 'Group' })).toHaveValue('own');
  });

  it('refuses a blank or duplicate name', async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    const form = screen.getByRole('dialog', { name: 'New category' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(within(form).getByRole('textbox', { name: 'Category name' }), '☕️ coffee');
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(form).toHaveTextContent('A category named Coffee already exists');
  });

  it('saves a new category with type, budget, color and group', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc(), 'createCategory');
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    const form = screen.getByRole('dialog', { name: 'New category' });
    await user.click(within(form).getByRole('radio', { name: 'Excluded' }));
    await user.type(within(form).getByRole('textbox', { name: 'Category name' }), 'Bikes');
    await user.type(within(form).getByRole('textbox', { name: 'Budget' }), '40');
    await user.click(within(form).getByRole('radio', { name: 'Color 3' }));
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Group' }), 'Transportation');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Bikes', budgetCents: 4000, excluded: true, color: PALETTE[2], groupTarget: { existing: 2 },
    }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument();
  });

  it('can start a new group from the form', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc(), 'createCategory');
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    const form = screen.getByRole('dialog', { name: 'New category' });
    await user.type(within(form).getByRole('textbox', { name: 'Category name' }), 'Bikes');
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Group' }), 'new');
    await user.type(within(form).getByRole('textbox', { name: 'New group name' }), 'Hobbies');
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ groupTarget: { new: 'Hobbies' } }));
  });

  it('closes the form with Escape without saving', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(ipc(), 'createCategory');
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: 'Start from scratch' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'New category' })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('AddCategoryMenu templates and errors', () => {
  it('hides templates whose name is already taken by a group', async () => {
    const user = userEvent.setup();
    render(<AddCategoryMenu groups={groups} existingNames={[]} takenGroupNames={['Home', 'Transportation']} onCreated={onCreated} />);
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    expect(screen.queryByRole('menuitem', { name: /^🏠 Home$|Home/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Transportation/ })).not.toBeInTheDocument();
  });

  it('says why a template could not be added instead of failing silently', async () => {
    const user = userEvent.setup();
    vi.spyOn(ipc(), 'createCategory').mockRejectedValueOnce({ code: 'invalid', message: 'a group named Pets already exists' });
    renderMenu();
    await user.click(screen.getByRole('button', { name: 'Add category' }));
    await user.click(screen.getByRole('menuitem', { name: /Pets/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a group named Pets already exists');
    expect(onCreated).not.toHaveBeenCalled();
  });
});
