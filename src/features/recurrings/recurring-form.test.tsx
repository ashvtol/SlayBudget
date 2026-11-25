import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecurringForm } from './recurring-form';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';

afterEach(() => cleanup());

const initial = { name: 'Netflix', categoryId: null, matchKind: 'merchant' as const, pattern: 'netflix', minCents: 1500, maxCents: 2000, frequency: 'monthly' as const, dayOfMonth: 5 };

describe('RecurringForm amounts', () => {
  it('will not save with an empty or negative amount', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<RecurringForm initial={initial} categories={[]} onSave={onSave} onCancel={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.clear(screen.getByLabelText('Minimum amount'));
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText('Minimum amount'), '-5');
    expect(save).toBeDisabled();
    await user.clear(screen.getByLabelText('Minimum amount'));
    await user.type(screen.getByLabelText('Minimum amount'), '12');
    expect(save).toBeEnabled();
    await user.clear(screen.getByLabelText('Maximum amount'));
    expect(save).toBeDisabled();
  });
});

describe('RecurringForm fields', () => {
  it('gives text boxes and dropdowns the same fixed height', () => {
    render(<RecurringForm initial={initial} categories={[]} onSave={async () => {}} onCancel={() => {}} />);
    const fields = [...screen.getAllByRole('textbox'), ...screen.getAllByRole('combobox'), screen.getByRole('button', { name: 'Category' })];
    expect(fields.length).toBeGreaterThanOrEqual(7);
    for (const f of fields) expect(f).toHaveClass('h-[34px]');
  });
});

describe('RecurringForm category', () => {
  it('finds a category by typing and saves it', async () => {
    const { createMemoryIpc, setIpc } = await import('@/lib/ipc');
    setIpc(createMemoryIpc({}));
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    const categories = [
      { id: 7, groupId: 1, name: 'Restaurants', emoji: '🍜', color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 1, archived: false },
      { id: 8, groupId: 1, name: 'Subscriptions', emoji: '📺', color: null, budgetCents: null, excluded: false, kind: 'expense' as const, sortOrder: 2, archived: false },
    ];
    render(<RecurringForm initial={initial} categories={categories} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('From its transactions');
    await user.click(screen.getByRole('button', { name: 'Category' }));
    await user.type(screen.getByRole('textbox', { name: 'Search categories' }), 's{Enter}');
    expect(screen.getByRole('button', { name: 'Category' })).toHaveTextContent('📺 Subscriptions');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 8 }));
  });
});

describe('RecurringForm frequency', () => {
  it('offers bills paid every 2, 3 or 4 years', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => {});
    render(<RecurringForm initial={initial} categories={[]} onSave={onSave} onCancel={() => {}} />);
    const frequency = screen.getByRole('combobox', { name: 'Frequency' });
    const options = [...frequency.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Weekly', 'Every 2 weeks', 'Monthly', 'Quarterly', 'Annually', 'Every 2 years', 'Every 3 years', 'Every 4 years']);
    await user.selectOptions(frequency, 'Every 3 years');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'triennial' }));
  });
});

describe('RecurringForm duplicates', () => {
  it('warns before saving a new bill with the same rule as one you already have', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc({}));
    await ipc().createRecurring({ ...initial, name: 'Netflix Premium', pattern: 'NETFLIX' });
    render(<RecurringForm initial={initial} categories={[]} preview onSave={async () => {}} onCancel={() => {}} />);
    expect(await screen.findByText('You already have Netflix Premium with this rule. Saving makes a second bill.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    await user.clear(screen.getByLabelText('Match text'));
    await user.type(screen.getByLabelText('Match text'), 'hulu');
    expect(screen.queryByText(/You already have/)).not.toBeInTheDocument();
  });

  it('does not warn when editing a bill', async () => {
    setIpc(createMemoryIpc({}));
    await ipc().createRecurring(initial);
    render(<RecurringForm initial={initial} categories={[]} onSave={async () => {}} onCancel={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/You already have/)).not.toBeInTheDocument();
  });
});
