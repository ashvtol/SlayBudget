import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { createMemoryIpc, setIpc, type Ipc } from '@/lib/ipc';
import type { AccountChoice, ImportReport } from '@/lib/types';
import { useProfileStore } from '@/lib/stores/profile-store';
import { ImportPage } from './import-page';
import { useBackgroundImports } from './background-imports';
import { useNavStore } from '@/lib/stores/nav-store';
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

const needsFor = (bank: string | null, last4: string | null, guess: number | null = null): ImportReport => ({
  ...needs(guess),
  needsAccount: { ...needs(guess).needsAccount!, clues: { last4, bank, layout: 'csv:x', folder: null }, suggestedName: `${bank ?? 'Card'} ${last4 ?? ''}`.trim() },
});

describe('ImportPage: many statements, one question per account', () => {
  /** A fake importer: files are unknown until an answer remembers their card; chosen accounts get ids 9, 10, ... */
  function batch(cardOf: (name: string) => [string | null, string | null]) {
    const remembered = new Map<string, number>();
    let next = 9;
    const importCsvText = vi.fn(async (_p: number, path: string, _t: string, account?: AccountChoice) => {
      const [bank, last4] = cardOf(path);
      const key = `${bank}|${last4}`;
      if (account) {
        const id = account.kind === 'existing' ? account.sourceId : next++;
        if (account.remember && last4) remembered.set(key, id);
        return report({ sourceId: id, sourceName: `Account ${id}`, inserted: 2 });
      }
      const known = remembered.get(key);
      return known ? report({ sourceId: known, sourceName: `Account ${known}`, inserted: 2 }) : needsFor(bank, last4);
    });
    return { importCsvText, d: deps({ importCsvText, listSources: vi.fn(async () => sources), listTags: vi.fn(async () => []) } as Partial<Ipc>) };
  }
  const chaseOrAmex = (name: string): [string | null, string | null] => (name.startsWith('amex') ? ['Amex', '1009'] : ['Chase', '7781']);

  it('asks once for three statements from the same card and imports all three into it', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = batch(chaseOrAmex);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('chase-jan.csv'), csv('chase-feb.csv'), csv('chase-mar.csv')]);
    const asks = await screen.findAllByRole('region', { name: /Which account/ });
    expect(asks).toHaveLength(1);
    const ask = asks[0];
    expect(ask).toHaveAccessibleName('Which account is Chase ending 7781?');
    expect(ask).toHaveTextContent('3 statements');
    expect(ask).toHaveTextContent('Show 3 files');
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument());
    const answered = importCsvText.mock.calls.filter((c) => c[3]);
    expect(answered.map((c) => c[3])).toEqual([
      expect.objectContaining({ kind: 'new' }),
      { kind: 'existing', sourceId: 9, remember: true },
      { kind: 'existing', sourceId: 9, remember: true },
    ]);
    expect(screen.getByLabelText('Import results')).toHaveTextContent('Imported 6 transactions');
  });

  it('Import all answers every card with its best guess, making one account per card', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = batch(chaseOrAmex);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('chase-jan.csv'), csv('amex-jan.csv'), csv('chase-feb.csv'), csv('amex-feb.csv')]);
    expect(await screen.findAllByRole('region', { name: /Which account/ })).toHaveLength(2);
    const bar = screen.getByRole('region', { name: '4 statements need an account' });
    await user.click(within(bar).getByRole('button', { name: 'Import all' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument());
    const created = importCsvText.mock.calls.filter((c) => c[3]?.kind === 'new');
    expect(created).toHaveLength(2);
    expect(screen.getByLabelText('Import results')).toHaveTextContent('Imported 8 transactions');
  });

  it('Skip all leaves every waiting statement out', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = batch(chaseOrAmex);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('chase-jan.csv'), csv('amex-jan.csv')]);
    const bar = await screen.findByRole('region', { name: '2 statements need an account' });
    await user.click(within(bar).getByRole('button', { name: 'Skip all' }));
    expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument();
    expect(importCsvText).toHaveBeenCalledTimes(2);
  });

  it('statements without an account number can be picked one by one', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { importCsvText, d } = batch(() => [null, null]);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('one.csv'), csv('two.csv'), csv('three.csv')]);
    const ask = await screen.findByRole('region', { name: 'Which account are these statements?' });
    expect(ask).toHaveTextContent('Statements without an account number');
    const boxes = within(ask).getAllByRole('checkbox', { name: /\.csv$/ });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true]);
    await user.click(within(ask).getByRole('checkbox', { name: 'two.csv' }));
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(importCsvText.mock.calls.filter((c) => c[3]).map((c) => c[1])).toEqual(['one.csv', 'three.csv']));
    const left = await screen.findByRole('region', { name: 'Which account is two.csv?' });
    expect(left).toBeInTheDocument();
  });

  it('turns Import off for the group when no statement is picked', async () => {
    setProfiles();
    const user = userEvent.setup();
    const { d } = batch(() => [null, null]);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('one.csv'), csv('two.csv')]);
    const ask = await screen.findByRole('region', { name: 'Which account are these statements?' });
    await user.click(within(ask).getByRole('checkbox', { name: 'one.csv' }));
    await user.click(within(ask).getByRole('checkbox', { name: 'two.csv' }));
    expect(within(ask).getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('after an answer that is remembered, other waiting statements are checked again', async () => {
    setProfiles();
    const user = userEvent.setup();
    // The Amex files turn out to be recognized once anything is remembered (as when a folder or layout matches).
    let answered = false;
    const base = batch(chaseOrAmex);
    const importCsvText = vi.fn(async (p: number, path: string, t: string, account?: AccountChoice) => {
      if (account) answered = true;
      if (!account && answered && path.startsWith('amex')) return report({ sourceId: 3, sourceName: 'Gold', inserted: 1 });
      return base.importCsvText(p, path, t, account);
    });
    const d = deps({ importCsvText, listSources: vi.fn(async () => sources), listTags: vi.fn(async () => []) } as Partial<Ipc>);
    render(<ImportPage deps={d} />);
    await user.upload(screen.getByLabelText('Choose files'), [csv('chase-jan.csv'), csv('amex-jan.csv')]);
    const ask = await screen.findByRole('region', { name: 'Which account is chase-jan.csv?' });
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: /Which account/ })).not.toBeInTheDocument());
    expect(screen.getByLabelText('Import results')).toHaveTextContent('Gold · 1 added');
  });
});

describe('ImportPage: statements found in the background', () => {
  it('shows ones waiting for an account, and answering imports them', async () => {
    setProfiles();
    const user = userEvent.setup();
    const answerMany = vi.fn(async () => {});
    useBackgroundImports.setState({
      waiting: [{ path: '/Users/me/Downloads/Chase7781_Activity.csv', name: 'Chase7781_Activity.csv', modifiedMs: 1, needs: needs(1).needsAccount! }],
      answerMany,
    });
    render(<ImportPage deps={deps({ listSources: vi.fn(async () => sources), listTags: vi.fn(async () => []) } as Partial<Ipc>)} />);
    const found = await screen.findByRole('region', { name: 'Found in your folders' });
    const ask = within(found).getByRole('region', { name: 'Which account is Chase7781_Activity.csv?' });
    await waitFor(() => expect(within(ask).getAllByRole('radio')[0]).toHaveAccessibleName('Freedom Likely'));
    await user.click(within(ask).getByRole('button', { name: 'Import' }));
    expect(answerMany).toHaveBeenCalledWith(['/Users/me/Downloads/Chase7781_Activity.csv'], { kind: 'existing', sourceId: 1, remember: true });
    useBackgroundImports.setState({ waiting: [] });
  });
});

describe('ImportPage: Import all for statements found in folders', () => {
  it('says it is importing while it works, then refreshes Recent imports', async () => {
    setProfiles();
    const user = userEvent.setup();
    let finish = () => {};
    const answerMany = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const listImports = vi.fn(async () => []);
    setIpc({ ...createMemoryIpc(), listImports } as unknown as Ipc);
    const chase = needsFor('Chase', '7781').needsAccount!;
    const amex = needsFor('Amex', '1009').needsAccount!;
    useBackgroundImports.setState({
      waiting: [
        { path: '/w/chase.csv', name: 'chase.csv', modifiedMs: 1, needs: chase },
        { path: '/w/amex.csv', name: 'amex.csv', modifiedMs: 1, needs: amex },
      ],
      answerMany,
    });
    render(<ImportPage deps={deps({ listSources: vi.fn(async () => sources), listTags: vi.fn(async () => []) } as Partial<Ipc>)} />);
    const bar = await screen.findByRole('region', { name: '2 statements need an account' });
    await waitFor(() => expect(listImports).toHaveBeenCalled());
    const loads = listImports.mock.calls.length;
    await user.click(within(bar).getByRole('button', { name: 'Import all' }));
    expect(within(bar).getByRole('button', { name: 'Importing…' })).toBeDisabled();
    expect(within(bar).getByRole('button', { name: 'Skip all' })).toBeDisabled();
    finish();
    await waitFor(() => expect(answerMany).toHaveBeenCalledTimes(1));
    finish();
    await waitFor(() => expect(answerMany).toHaveBeenCalledTimes(2));
    finish();
    await waitFor(() => expect(listImports.mock.calls.length).toBeGreaterThan(loads));
    useBackgroundImports.setState({ waiting: [] });
  });
});

describe('ImportPage: keeping statements organized', () => {
  it('explains account folders with an example and opens Settings > Accounts to set them up', async () => {
    setProfiles();
    const user = userEvent.setup();
    useNavStore.setState({ settingsOpen: false, settingsPane: null });
    render(<ImportPage deps={deps()} />);
    const guide = screen.getByRole('region', { name: 'Keep statements organized' });
    expect(guide).toHaveTextContent('Give each account its own folder');
    expect(within(guide).getByRole('img', { name: /Example folders/ })).toHaveTextContent('Amex Gold/');
    expect(guide).toHaveTextContent('default tag');
    await user.click(within(guide).getByRole('button', { name: 'Set up folders' }));
    expect(useNavStore.getState()).toMatchObject({ settingsOpen: true, settingsPane: 'accounts' });
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
