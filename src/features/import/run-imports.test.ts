import { vi } from 'vitest';
import type { Ipc } from '@/lib/ipc';
import type { ImportReport } from '@/lib/types';
import { answerGroup, classifyFile, importPath, runImports, summarize } from './run-imports';
import type { AccountChoice } from '@/lib/types';

function file(name: string, body = 'data', relPath?: string): File {
  const f = new File([body], name, { type: 'text/plain' });
  if (relPath) Object.defineProperty(f, 'webkitRelativePath', { value: relPath });
  return f;
}

function report(over: Partial<ImportReport> = {}): ImportReport {
  return { sourceName: 'Amex', inserted: 3, duplicates: 0, skipped: 0, alreadyImported: false, ...over };
}

function fakeIpc(over: Partial<Ipc> = {}): Ipc {
  return {
    importCsvText: vi.fn(async () => report()),
    importOfxText: vi.fn(async () => report({ sourceName: 'Citi' })),
    importPdfDoc: vi.fn(async () => report({ sourceName: 'Citi-Checking', inserted: 5 })),
    ...over,
  } as unknown as Ipc;
}

const deps = (ipc: Ipc) => ({
  ipc,
  readText: (f: File) => f.text(),
  extractPdf: vi.fn(async (f: File) => ({ lines: [], filename: f.name })),
  hashFile: (f: File) => `${f.name}:${f.size}`,
});

describe('classifyFile', () => {
  it('maps extensions, case-insensitively', () => {
    expect(classifyFile('YTD.CSV')).toBe('csv');
    expect(classifyFile('stmt.qfx')).toBe('ofx');
    expect(classifyFile('March 09.pdf')).toBe('pdf');
    expect(classifyFile('notes.txt')).toBe('unsupported');
  });
});

describe('importPath', () => {
  it('prefers the folder-relative path', () => {
    expect(importPath(file('a.csv', 'x', 'Statements/Alex/Amex/a.csv'))).toBe('Statements/Alex/Amex/a.csv');
    expect(importPath(file('a.csv'))).toBe('a.csv');
  });
});

describe('runImports', () => {
  it('routes each file to the right importer and collects reports', async () => {
    const ipc = fakeIpc();
    const d = deps(ipc);
    const results = await runImports([file('a.csv'), file('b.qfx'), file('c.pdf'), file('d.txt')], 1, d);
    expect(results.map((r) => r.error ?? r.report!.sourceName)).toEqual(['Amex', 'Citi', 'Citi-Checking', 'Unsupported file type']);
    expect(ipc.importCsvText).toHaveBeenCalledWith(1, 'a.csv', 'data', undefined);
    expect(d.extractPdf).toHaveBeenCalledOnce();
  });

  it('reports progress and keeps going after a failing file', async () => {
    const ipc = fakeIpc({ importCsvText: vi.fn(async () => { throw new Error('bad csv'); }) });
    const progress: number[] = [];
    const results = await runImports([file('a.csv'), file('b.qfx')], 1, deps(ipc), (done) => progress.push(done));
    expect(results[0].error).toBe('bad csv');
    expect(results[1].report?.sourceName).toBe('Citi');
    expect(Math.max(...progress)).toBe(2);
  });

  it('summarizes inserted, duplicate and failed counts', () => {
    const results = [
      { name: 'a', report: report({ inserted: 3, duplicates: 1 }) },
      { name: 'b', report: report({ inserted: 5, duplicates: 2 }) },
      { name: 'c', error: 'nope' },
    ];
    expect(summarize(results)).toEqual({ imported: 8, duplicates: 3, failed: 1, waiting: 0 });
  });
});

describe('answerGroup', () => {
  const NEW: AccountChoice = {
    kind: 'new',
    account: { name: 'Chase 7781', institution: 'Chase', accountType: 'card', color: null, defaultTagId: null },
    remember: false,
  };

  it('makes the new account once and puts the rest of the group in it', async () => {
    const importCsvText = vi.fn(async () => report({ sourceId: 9, sourceName: 'Chase 7781' }));
    const files = ['a', 'b', 'c'].map((id) => ({ id, file: file(`${id}.csv`) }));
    const results = await answerGroup(files, 1, deps(fakeIpc({ importCsvText })), NEW);
    expect(importCsvText).toHaveBeenCalledTimes(3);
    expect((importCsvText.mock.calls as unknown[][])[0][3]).toEqual(NEW);
    expect((importCsvText.mock.calls as unknown[][])[1][3]).toEqual({ kind: 'existing', sourceId: 9, remember: false });
    expect((importCsvText.mock.calls as unknown[][])[2][3]).toEqual({ kind: 'existing', sourceId: 9, remember: false });
    expect([...results.keys()]).toEqual(['a', 'b', 'c']);
    expect(results.get('c')?.report?.sourceName).toBe('Chase 7781');
  });

  it('when the first file fails, the next one gets the original choice, so the account is still made once', async () => {
    let n = 0;
    const importCsvText = vi.fn(async () => {
      n++;
      if (n === 1) throw new Error('unreadable');
      return report({ sourceId: 9 });
    });
    const files = ['a', 'b', 'c'].map((id) => ({ id, file: file(`${id}.csv`) }));
    const results = await answerGroup(files, 1, deps(fakeIpc({ importCsvText })), NEW);
    expect((importCsvText.mock.calls as unknown[][])[1][3]).toEqual(NEW);
    expect((importCsvText.mock.calls as unknown[][])[2][3]).toEqual({ kind: 'existing', sourceId: 9, remember: false });
    expect(results.get('a')?.error).toBe('unreadable');
  });

  it('passes the path a file was found at', async () => {
    const importCsvText = vi.fn(async () => report({ sourceId: 2 }));
    await answerGroup([{ id: 'x', file: file('x.csv'), path: '/Users/me/Statements/x.csv' }], 1, deps(fakeIpc({ importCsvText })), { kind: 'existing', sourceId: 2, remember: true });
    expect((importCsvText.mock.calls as unknown[][])[0][1]).toBe('/Users/me/Statements/x.csv');
  });
});
