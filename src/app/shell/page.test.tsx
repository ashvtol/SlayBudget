import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach } from 'vitest';
import { SplitPage } from './page';

afterEach(() => cleanup());
beforeEach(() => localStorage.clear());

const page = () => render(<SplitPage title="Recurrings" list={<p>list</p>} detail={<p>detail</p>} />);
const divider = () => screen.getByRole('separator', { name: 'Resize the list' });
const listWidth = () => (screen.getByText('list').closest('section') as HTMLElement).style.width;

describe('SplitPage divider', () => {
  it('drags to resize the list, and remembers the width for that page', () => {
    page();
    expect(divider()).toHaveAttribute('aria-valuenow', '564');
    fireEvent.pointerDown(divider(), { clientX: 564, pointerId: 1 });
    fireEvent.pointerMove(divider(), { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(divider(), { clientX: 700, pointerId: 1 });
    expect(listWidth()).toBe('700px');
    cleanup();
    page();
    expect(listWidth()).toBe('700px');
    cleanup();
    render(<SplitPage title="Transactions" list={<p>list</p>} detail={<p>detail</p>} />);
    expect(listWidth()).toBe('564px');
  });

  it('keeps the list between its limits', () => {
    page();
    fireEvent.pointerDown(divider(), { clientX: 564, pointerId: 1 });
    fireEvent.pointerMove(divider(), { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(divider(), { clientX: 50, pointerId: 1 });
    expect(listWidth()).toBe('360px');
  });

  it('moves with the arrow keys and resets on double-click', async () => {
    const user = userEvent.setup();
    page();
    divider().focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(listWidth()).toBe('596px');
    await user.dblClick(divider());
    expect(listWidth()).toBe('564px');
    expect(localStorage.getItem('split-width:Recurrings')).toBeNull();
  });
});
