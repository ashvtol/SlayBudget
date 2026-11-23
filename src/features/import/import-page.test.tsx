import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import type { Ipc } from '@/lib/ipc';
import type { ImportReport } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { ImportPage } from './import-page';
import { useBackgroundImports } from './background-imports';
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

const needs = (guess: number | null): ImportReport => ({
  sourceName: '', inserted: 0, duplicates: 0, skipped: 0, alreadyImported: false,
  needsAccount: {
    clues: { last4: '7781', bank: 'Chase', layout: 'csv:x', folder: null },
    guess,
    suggestedName: 'Chase ••7781',
    preview: { rows: 2, first: '2026-11-03', last: '2026-11-05', sample: [{ postedOn: '2026-11-03', description: 'UBER TRIP', amountCents: -1200 }] },
  },
});
const sources = [
  { id: 1, profileId: 1, name: 'Freedom', kind: 'csv' as const, institution: 'Chase', currency: 'USD' },
  { id: 2, profileId: 1, name: 'Sapphire', kind: 'csv' as const, institution: 'Chase', currency: 'USD' },
];

describe('ImportPage: which account is this?', () => {
  function asking(guess: number | null) {
    const importCsvText = vi.fn(async (_p: number, _path: string, _t: string, account?: unknown) => (account ? report({ sourceName: 'Sapphire', inserted: 2 }) : needs(guess)));
    return { importCsvText, d: deps({ importCsvText, listSources: vi.fn(async () => sources), listTags: vi.fn(async () => [{ id: 9, name: 'Business', color: '#ddb24a', count: 0 }]) } as Partial<Ipc>) };
  }

  it('asks with a preview and the likely account first, then imports there and remembers', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = asking(2);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('Chase7781_Activity.csv')]);
    const ask = await screen.findByRole('region', { name: 'Which account is Chase7781_Activity.csv?' });
    expect(ask).toHaveTextContent('2 transactions · Nov 3 to Nov 5, 2026');
    expect(ask).toHaveTextContent('Chase, ending 7781');
    expect(ask).toHaveTextContent('UBER TRIP');
    const options = within(ask).getAllByRole('radio');
    expect(options[0]).toHaveAccessibleName('Sapphire Likely');
    expect(options[0]).toBeChecked();
    expect(within(ask).getByRole('checkbox', { name: 'Remember for files like this' })).toBeChecked();
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importCsvText).toHaveBeenLastCalledWith(1, 'Chase7781_Activity.csv', expect.any(String), { kind: 'existing', sourceId: 2, remember: true }));
    expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Import results')).toHaveTextContent('Sapphire · 2 added');
  });

  it('can make a new account with a type and a default tag', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = asking(null);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('Chase7781_Activity.csv')]);
    const ask = await screen.findByRole('region', { name: /Which account/ });
    expect(within(ask).getByRole('radio', { name: 'New account' })).toBeChecked();
    expect(within(ask).getByRole('textbox', { name: 'Account name' })).toHaveValue('Chase ••7781');
    expect(within(ask).getByRole('textbox', { name: 'Bank' })).toHaveValue('Chase');
    await user.clear(within(ask).getByRole('textbox', { name: 'Account name' }));
    await user.type(within(ask).getByRole('textbox', { name: 'Account name' }), 'Sapphire Reserve');
    await user.click(within(ask).getByRole('radio', { name: 'Checking' }));
    await user.selectOptions(within(ask).getByRole('combobox', { name: 'Default tag' }), 'Business');
    await user.click(within(ask).getByRole('checkbox', { name: 'Remember for files like this' }));
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    await waitFor(() =>
      expect(importCsvText).toHaveBeenLastCalledWith(1, 'Chase7781_Activity.csv', expect.any(String), {
        kind: 'new',
        account: { name: 'Sapphire Reserve', institution: 'Chase', accountType: 'checking', color: null, defaultTagId: 9 },
        remember: false,
      }),
    );
  });

  it('skipping leaves the file out', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = asking(1);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('a.csv')]);
    const ask = await screen.findByRole('region', { name: /Which account/ });
    expect(screen.getByLabelText('Import results')).toHaveTextContent('1 needs an account');
    await user.click(within(ask).getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument();
    expect(importCsvText).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Import results')).toHaveTextContent('skipped');
  });
});

describe('ImportPage: statements found in the background', () => {
  it('shows ones waiting for an account, and answering imports them', async () => {
    setProfiles();
    const user = userEvent.setup();
    const answer = vi.fn(async () => null);
    useBackgroundImports.setState({
      waiting: [{ path: '/Users/me/Downloads/Chase7781_Activity.csv', name: 'Chase7781_Activity.csv', modifiedMs: 1, needs: needs(1).needsAccount! }],
      answer,
    });
    render(<ImportPage deps={deps({ listSources: vi.fn(async () => sources), listTags: vi.fn(async () => []) } as Partial<Ipc>)} />);
    const found = await screen.findByRole('region', { name: 'Found in your folders' });
    const ask = within(found).getByRole('region', { name: 'Which account is Chase7781_Activity.csv?' });
    await waitFor(() => expect(within(ask).getAllByRole('radio')[0]).toHaveAccessibleName('Freedom Likely'));
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    expect(answer).toHaveBeenCalledWith('/Users/me/Downloads/Chase7781_Activity.csv', { kind: 'existing', sourceId: 1, remember: true });
    useBackgroundImports.setState({ waiting: [] });
  });
});

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
