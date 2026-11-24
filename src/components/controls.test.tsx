import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Select } from './select';
import { SegmentedControl } from './segmented-control';

afterEach(() => cleanup());

describe('Button', () => {
  it('is a macOS push button in four variants, secondary by default, and passes its props through', async () => {
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick}>Cancel</Button>
        <Button variant="primary">Import</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="plain" aria-label="Review them">Review in Transactions</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn', 'btn-secondary');
    expect(screen.getByRole('button', { name: 'Import' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('btn-destructive');
    expect(screen.getByRole('button', { name: 'Review them' })).toHaveClass('btn-plain');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('is the native pop-up (so the list is the system one) with the ↕ badge', async () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Default tag" value="" onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        <option value="9">Business</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Default tag' });
    expect(select).toHaveClass('popup');
    await userEvent.selectOptions(select, 'Business');
    expect(onChange).toHaveBeenCalledWith('9');
    expect(select.parentElement?.querySelector('[data-popup-badge]')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('SegmentedControl', () => {
  it('is a radio group whose selected option carries the sliding pill', async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="Type"
        options={[{ id: 'card', label: 'Card' }, { id: 'checking', label: 'Checking' }, { id: 'savings', label: 'Savings' }]}
        value="card"
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(screen.getByRole('radio', { name: 'Card' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Checking' })).not.toBeChecked();
    expect(group.querySelector('[data-segment-thumb]')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Savings' }));
    expect(onChange).toHaveBeenCalledWith('savings');
  });

  it('fills its container with equal segments when asked, with dividers only between unselected ones', () => {
    render(
      <SegmentedControl
        aria-label="Style"
        fill
        options={[{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }, { id: 'c', label: 'Three' }]}
        value="a"
        onChange={() => {}}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Style' });
    expect(group).toHaveClass('segmented-fill');
    const radios = screen.getAllByRole('radio');
    // One | Two: no divider next to the selected One; Two | Three: a divider.
    expect(radios.map((r) => r.getAttribute('data-divider'))).toEqual([null, null, 'true']);
  });
});
