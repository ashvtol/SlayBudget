import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import type { Category } from '@/lib/types';
import { CategoryPopup } from './category-popup';

afterEach(() => cleanup());

const cat = (id: number, name: string, emoji: string): Category => ({
  id, groupId: 1, name, emoji, color: null, budgetCents: null, excluded: false, kind: 'expense', sortOrder: id, archived: false,
});
const categories = [cat(1, 'Restaurants', '🍜'), cat(2, 'Subscriptions', '📺'), cat(3, 'Shopping', '🛍️')];

function renderPopup(onChange = vi.fn(), value: number | null = null, noneLabel?: string) {
  setIpc(createMemoryIpc({}));
  render(<CategoryPopup label="Category for Wise" categories={categories} value={value} onChange={onChange} placeholder="Choose category" noneLabel={noneLabel} />);
  return onChange;
}

describe('CategoryPopup', () => {
  it('shows the choice with its emoji, or the placeholder', () => {
    renderPopup(vi.fn(), 2);
    expect(screen.getByRole('button', { name: 'Category for Wise' })).toHaveTextContent('📺 Subscriptions');
  });

  it('typing narrows the list, and clicking picks', async () => {
    const user = userEvent.setup();
    const onChange = renderPopup();
    expect(screen.getByRole('button', { name: 'Category for Wise' })).toHaveTextContent('Choose category');
    await user.click(screen.getByRole('button', { name: 'Category for Wise' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'sub');
    const menu = screen.getByRole('dialog', { name: 'Choose category' });
    expect(within(menu).queryByRole('button', { name: /Restaurants/ })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: /Subscriptions/ }));
    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog', { name: 'Choose category' })).not.toBeInTheDocument();
  });

  it('Return picks the first match', async () => {
    const user = userEvent.setup();
    const onChange = renderPopup();
    await user.click(screen.getByRole('button', { name: 'Category for Wise' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 'shop{Enter}');
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('Escape closes without a change', async () => {
    const user = userEvent.setup();
    const onChange = renderPopup();
    await user.click(screen.getByRole('button', { name: 'Category for Wise' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose category' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers a "none" choice when asked', async () => {
    const user = userEvent.setup();
    const onChange = renderPopup(vi.fn(), 2, 'From its transactions');
    await user.click(screen.getByRole('button', { name: 'Category for Wise' }));
    await user.click(screen.getByRole('button', { name: 'From its transactions' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
