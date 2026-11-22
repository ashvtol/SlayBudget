import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/tauri-ipc', () => ({ isTauri: () => tauri.on }));
const dialog = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);
import { createMemoryIpc, setIpc } from '@/lib/ipc';
import { DataPane } from './data-pane';

afterEach(() => cleanup());

describe('DataPane', () => {
  it('shows transaction count and imports a legacy JSON file', async () => {
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    render(<DataPane />);
    await waitFor(() => expect(screen.getByText('0 transactions')).toBeInTheDocument());

    const file = new File([JSON.stringify([{ a: 1 }, { a: 2 }, { a: 3 }])], 'export.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Transactions file'), file);
    await waitFor(() => expect(screen.getByText(/Imported 3 transactions/)).toBeInTheDocument());
  });

  it('reviews and imports categorization rules', async () => {
    const user = userEvent.setup();
    const memory = createMemoryIpc({
      transactions: [
        { id: 1, profileId: 1, sourceId: 1, postedOn: '2026-05-01', description: 'DIN TAI FUNG', merchant: 'din tai', amountCents: -4000, currency: 'USD', categoryId: null, categoryLocked: false, reviewed: false, notes: null, refundOf: null },
      ],
    });
    setIpc(memory);
    render(<DataPane />);
    const model = JSON.stringify({ learningModel: { 'din tai': 'Groceries' } });
    await user.upload(screen.getByLabelText('Rules file'), new File([model], 'ai-model.json', { type: 'application/json' }));
    const review = await screen.findByRole('region', { name: 'Review imported rules' });
    await user.click(within(review).getByRole('button', { name: 'Import 1 merchant' }));
    await waitFor(() => expect(within(review).getByRole('status')).toHaveTextContent('Learned 1 merchant, moved 1 transaction.'));
    expect((await memory.listTransactions({}))[0].categoryId).toBe(10);
  });
});

describe('DataPane buttons and wording', () => {
  it('shows real buttons with generic names, not bare file inputs or another app', async () => {
    setIpc(createMemoryIpc());
    render(<DataPane />);
    expect(screen.getByRole('button', { name: 'Import transactions…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import rules…' })).toBeInTheDocument();
    expect(screen.getByLabelText('Transactions file')).toHaveClass('hidden');
    expect(screen.getByRole('region', { name: 'Data and backup' })).not.toHaveTextContent('Financial-Tracker');
  });

  it('backs the database up to a file you choose (in the app)', async () => {
    tauri.on = true;
    const user = userEvent.setup();
    const memory = createMemoryIpc();
    const backup = vi.spyOn(memory, 'backupDatabase');
    setIpc(memory);
    dialog.save.mockResolvedValue('/Users/me/Desktop/slaybudget-backup.db');
    render(<DataPane />);
    await user.click(screen.getByRole('button', { name: 'Back up now…' }));
    await waitFor(() => expect(backup).toHaveBeenCalledWith('/Users/me/Desktop/slaybudget-backup.db'));
    expect(await screen.findByRole('status')).toHaveTextContent('Backed up to /Users/me/Desktop/slaybudget-backup.db');
    tauri.on = false;
  });
});

describe('DataPane export rules', () => {
  it('exports rules to a file you choose and says what was left out', async () => {
    tauri.on = true;
    const user = userEvent.setup();
    const memory = createMemoryIpc();
    const exportRules = vi.spyOn(memory, 'exportRules').mockResolvedValue({ learned: 304, rules: 3, leftOut: 12 });
    setIpc(memory);
    dialog.save.mockResolvedValue('/Users/me/Desktop/slaybudget-rules.json');
    render(<DataPane />);
    await user.click(screen.getByRole('button', { name: 'Export rules…' }));
    await waitFor(() => expect(exportRules).toHaveBeenCalledWith('/Users/me/Desktop/slaybudget-rules.json'));
    expect(await screen.findByText('Exported 304 merchants and 3 rules. Left out 12 that could identify you or your accounts.')).toBeInTheDocument();
    tauri.on = false;
  });

  it('does nothing when the save dialog is cancelled', async () => {
    tauri.on = true;
    const user = userEvent.setup();
    const memory = createMemoryIpc();
    const exportRules = vi.spyOn(memory, 'exportRules');
    setIpc(memory);
    dialog.save.mockResolvedValue(null);
    render(<DataPane />);
    await user.click(screen.getByRole('button', { name: 'Export rules…' }));
    await waitFor(() => expect(dialog.save).toHaveBeenCalled());
    expect(exportRules).not.toHaveBeenCalled();
    tauri.on = false;
  });
});

describe('DataPane file names', () => {
  it("suggests today's local date, not the UTC one, late in the evening", async () => {
    tauri.on = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 21, 23, 30)); // 11:30pm local: already the 22nd in UTC west of Greenwich
    dialog.save.mockClear();
    const user = userEvent.setup();
    setIpc(createMemoryIpc());
    dialog.save.mockResolvedValue(null);
    render(<DataPane />);
    await user.click(screen.getByRole('button', { name: 'Export rules…' }));
    await user.click(screen.getByRole('button', { name: 'Back up now…' }));
    await waitFor(() => expect(dialog.save).toHaveBeenCalledTimes(2));
    expect(dialog.save.mock.calls[0][0].defaultPath).toBe('slaybudget-rules-2026-11-21.json');
    expect(dialog.save.mock.calls[1][0].defaultPath).toBe('slaybudget-backup-2026-11-21.db');
    vi.useRealTimers();
    tauri.on = false;
  });
});
