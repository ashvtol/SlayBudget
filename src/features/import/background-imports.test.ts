import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryIpc, ipc, setIpc } from '@/lib/ipc';
import { useProfileStore } from '@/lib/stores/profile-store';
import { useBackgroundImports } from './background-imports';

const CHASE = 'Transaction Date,Description,Amount\n2026-11-03,UBER TRIP,-12.00\n2026-11-05,SHELL,-40.00\n';
const file = (path: string, text: string, modifiedMs = 1000, from: 'watched' | 'downloads' = 'downloads') => ({ path, text, modifiedMs, from });
const titles = async () => (await ipc().notificationsList(null)).map((n) => n.title).sort();

beforeEach(() => {
  useProfileStore.setState({ profiles: [{ id: 1, name: 'Me', color: '#5b8cff', sortOrder: 0 }], activeProfileId: 1 });
  useBackgroundImports.setState({ waiting: [], seen: {} });
});
function setup(files: ReturnType<typeof file>[]) {
  setIpc(
    createMemoryIpc({
      sources: [{ id: 1, profileId: 1, name: 'Freedom', kind: 'csv', institution: 'Chase', currency: 'USD' }],
      accountClues: [{ id: 1, sourceId: 1, kind: 'layout', value: 'csv:amount|description|transaction date' }],
      files,
    }),
  );
}

describe('background imports (watched folder and Downloads)', () => {
  it('imports a recognized statement and says so in the bell', async () => {
    setup([file('/Users/me/Downloads/activity.csv', CHASE)]);
    await useBackgroundImports.getState().scan();
    expect((await ipc().listTransactions({})).length).toBe(2);
    expect(await titles()).toEqual(['Imported 2 transactions from activity.csv into Freedom']);
  });

  it('a statement it can’t place waits for you, with a bell item, until you answer', async () => {
    setup([file('/Users/me/Downloads/Amex1004.csv', 'Date,Description,Amount\n2026-11-08,COFFEE,-4.50\n')]);
    await useBackgroundImports.getState().scan();
    const [waiting] = useBackgroundImports.getState().waiting;
    expect(waiting.name).toBe('Amex1004.csv');
    expect(waiting.needs.suggestedName).toBe('American Express ••1004');
    expect(await titles()).toEqual(['Amex1004.csv needs an account']);
    expect((await ipc().notificationsList(null))[0].target).toEqual({ kind: 'import' });
    await useBackgroundImports.getState().answer(waiting.path, { kind: 'existing', sourceId: 1, remember: true });
    expect(useBackgroundImports.getState().waiting).toEqual([]);
    expect((await ipc().listTransactions({})).map((t) => t.description)).toEqual(['COFFEE']);
  });

  it('ignores files that aren’t statements and doesn’t read unchanged files again', async () => {
    setup([file('/Users/me/Downloads/contacts.csv', 'Name,Email\nAsh,a@b.c\n'), file('/Users/me/Downloads/activity.csv', CHASE)]);
    const read = vi.spyOn(ipc(), 'readStatement');
    await useBackgroundImports.getState().scan();
    await useBackgroundImports.getState().scan();
    expect(read).toHaveBeenCalledTimes(2);
    expect(useBackgroundImports.getState().waiting).toEqual([]);
    expect((await ipc().listTransactions({})).length).toBe(2);
  });

  it('skipping a waiting file leaves it alone', async () => {
    setup([file('/Users/me/Downloads/x.csv', 'Date,Description,Amount\n2026-11-08,TEA,-4.50\n')]);
    await useBackgroundImports.getState().scan();
    useBackgroundImports.getState().skip('/Users/me/Downloads/x.csv');
    expect(useBackgroundImports.getState().waiting).toEqual([]);
    expect(await ipc().listTransactions({})).toEqual([]);
  });
});
