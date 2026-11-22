import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { Ipc } from '@/lib/ipc';
import type { ImportReport } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { ImportPage } from './import-page';
import type { ImportDeps } from './run-imports';

afterEach(() => cleanup());

function report(over: Partial<ImportReport> = {}): ImportReport {
  return { sourceName: 'Amex', inserted: 3, duplicates: 0, skipped: 0, alreadyImported: false, ...over };
}

function deps(over: Partial<Ipc> = {}): ImportDeps {
  return {
    ipc: { importCsvText: vi.fn(async () => report()), importOfxText: vi.fn(async () => report()), importPdfDoc: vi.fn(async () => report({ inserted: 5 })), ...over } as unknown as Ipc,
    readText: (f) => f.text(),
    extractPdf: vi.fn(async (f) => ({ lines: [], filename: f.name })),
    hashFile: (f) => f.name,
  };
}

function csv(name: string): File {
  return new File(['Date,Description,Amount\n01/01/2026,X,1.00'], name, { type: 'text/csv' });
}

function setProfiles() {
  useProfileStore.setState({ profiles: [{ id: 1, name: 'Alex', color: '#5b8cff', sortOrder: 0 }], activeProfileId: 1 });
}

describe('ImportPage', () => {
  it('imports chosen files and shows a results summary', async () => {
    setProfiles();
    const user = userEvent.setup();
    const d = deps();
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('amex.csv')]);
    expect(await screen.findByLabelText('Import results')).toHaveTextContent('Imported 3 transactions');
    expect(d.ipc.importCsvText).toHaveBeenCalled();
  });

  it('lists possible duplicates as a heads-up, with a way to review them', async () => {
    setProfiles();
    const user = userEvent.setup();
    const flag = (id: number, reason: string) => ({ id, txId: id + 10, otherId: id, importId: 4, confidence: 'likely' as const, reason, createdAt: '', resolvedAt: null, resolution: null });
    const d = deps({
      importCsvText: vi.fn(async () =>
        report({ inserted: 17, duplicates: 298, flags: [flag(1, 'Same place a day apart as SHAKE SHACK 123 on Nov 17 ($30.31); the amount changed by $6.00 (a tip?).'), flag(2, 'Same day and amount as COSTCO WHSE 0123 ($142.18, Amex, imported Nov 18), worded differently.')] }),
      ),
    });
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('amex-nov.csv')]);
    const results = await screen.findByLabelText('Import results');
    expect(results).toHaveTextContent('17 added · 298 already imported · 2 to check');
    const check = screen.getByRole('region', { name: '2 possible duplicates to check' });
    expect(within(check).getAllByRole('listitem')).toHaveLength(2);
    expect(check).toHaveTextContent('the amount changed by $6.00 (a tip?)');
    expect(check).toHaveTextContent('They are tagged Possible duplicate');
    expect(within(check).getByRole('button', { name: 'Review in Transactions' })).toBeInTheDocument();
  });

  it('calls onImported after a run so the app can refresh', async () => {
    setProfiles();
    const user = userEvent.setup();
    const onImported = vi.fn();
    render(<ImportPage deps={deps()} onImported={onImported} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('a.csv')]);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it('surfaces a per-file error without aborting the batch', async () => {
    setProfiles();
    const user = userEvent.setup();
    const d = deps({ importCsvText: vi.fn(async () => { throw new Error('bad header'); }) });
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('a.csv')]);
    expect(await screen.findByText('bad header')).toBeInTheDocument();
    expect(screen.getByLabelText('Import results')).toHaveTextContent('1 failed');
  });

  it('prompts to create a profile when none exists', () => {
    useProfileStore.setState({ profiles: [], activeProfileId: null });
    render(<ImportPage deps={deps()} />);
    expect(screen.getByText('Create a profile first')).toBeInTheDocument();
  });
});
