import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecurringForm } from './recurring-form';

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
    const fields = [...screen.getAllByRole('textbox'), ...screen.getAllByRole('combobox')];
    expect(fields.length).toBeGreaterThanOrEqual(7);
    for (const f of fields) expect(f).toHaveClass('h-[34px]');
  });
});
