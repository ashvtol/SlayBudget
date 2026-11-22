import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './sidebar';
import { SplitPage } from './page';
import { groupByInstitution, type SourceRow } from './use-sidebar-data';
import { Drawer } from '@/components/drawer';
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { useNavStore } from '@/lib/stores/nav-store';
import { useProfileStore } from '@/lib/stores/profile-store';
import type { Source, Transaction } from '@/lib/types';

const today = new Date();
const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

const src = (id: number, name: string, institution: string | null): Source => ({ id, profileId: 1, name, kind: 'csv', institution, currency: 'USD' });
const tx = (id: number, sourceId: number, cents: number, reviewed: boolean): Transaction => ({
  id, profileId: 1, sourceId, postedOn: thisMonth, description: 'X', merchant: 'X', amountCents: cents, currency: 'USD',
  categoryId: null, categoryLocked: false, reviewed, notes: null, refundOf: null,
});

beforeEach(() => {
  useNavStore.setState({ section: 'dashboard' });
  useProfileStore.setState({ activeProfileId: null });
});

describe('Sidebar', () => {
  it('shows the review count and sources grouped by institution with month spend', async () => {
    setIpc(createMemoryIpc({
      sources: [src(1, 'Amex Gold', 'American Express'), src(2, 'Citi Costco', 'Citi'), src(3, 'Citi Checking', 'Citi')],
      // 3 unreviewed, 1 reviewed; Citi Checking only has money in (a paycheck).
      transactions: [tx(1, 1, -2500, false), tx(2, 1, -1000, true), tx(3, 2, -4000, false), tx(4, 3, 50000, false)],
    }));
    render(<Sidebar />);
    const sources = await screen.findByRole('group', { name: 'Statement sources' });
    expect(within(sources).getByRole('button', { name: 'Citi' })).toBeInTheDocument();
    const amount = (name: string) => within(within(sources).getByText(name).closest('li') as HTMLElement).getByText((_, el) => el?.classList.contains('tabular-nums') === true).textContent;
    await waitFor(() => expect(amount('Amex Gold')).toBe('$35')); // 25 + 10 spent
    expect(amount('Citi Costco')).toBe('$40');
    expect(amount('Citi Checking')).toBe('$0'); // income is not spending
    const link = screen.getByRole('link', { name: 'Transactions' });
    expect(await within(link).findByText('3')).toBeInTheDocument();
  });

  it('collapses an institution group', async () => {
    setIpc(createMemoryIpc({ sources: [src(1, 'Amex Gold', 'American Express')] }));
    render(<Sidebar />);
    const toggle = await screen.findByRole('button', { name: 'American Express' });
    expect(screen.getByText('Amex Gold')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Amex Gold')).not.toBeInTheDocument();
  });

  it('navigates when a section is clicked', async () => {
    setIpc(createMemoryIpc());
    render(<Sidebar />);
    await userEvent.click(screen.getByRole('link', { name: 'Recurrings' }));
    expect(useNavStore.getState().section).toBe('recurring');
    expect(screen.getByRole('link', { name: 'Recurrings' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('window chrome', () => {
  it('reserves a draggable top row for the traffic lights, with the logo in it', () => {
    setIpc(createMemoryIpc());
    render(<Sidebar />);
    const top = screen.getByTestId('titlebar');
    expect(top).toHaveAttribute('data-tauri-drag-region');
    expect(within(top).getByRole('img', { name: 'SlayBudget' })).toBeInTheDocument();
  });

  it('makes page and panel header bars draggable', () => {
    const { container } = render(<SplitPage title="Recurrings" list={<p>list</p>} detailTitle="Rent" detail={<p>detail</p>} />);
    const bars = container.querySelectorAll('header');
    expect(bars).toHaveLength(2);
    bars.forEach((h) => expect(h).toHaveAttribute('data-tauri-drag-region'));
  });
});

describe('groupByInstitution', () => {
  it('keeps first-seen order and puts missing institutions under Other', () => {
    const rows: SourceRow[] = [src(1, 'A', 'Citi'), src(2, 'B', null), src(3, 'C', 'Citi')].map((source) => ({ source, monthSpendCents: 0 }));
    expect(groupByInstitution(rows).map((g) => [g.institution, g.rows.length])).toEqual([['Citi', 2], ['Other', 1]]);
  });
});

describe('SplitPage', () => {
  it('renders list and detail panes with their own headers', () => {
    render(<SplitPage title="Recurrings" list={<p>list</p>} detailTitle="Rent" detail={<p>detail</p>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Recurrings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Rent' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Details' })).toHaveTextContent('detail');
  });
});

describe('Drawer', () => {
  it('closes on Escape, backdrop and the close button', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Drawer open title="Spend" onClose={onClose}>content</Drawer>);
    expect(screen.getByRole('dialog', { name: 'Spend' })).toHaveTextContent('content');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    rerender(<Drawer open={false} title="Spend" onClose={onClose}>content</Drawer>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
