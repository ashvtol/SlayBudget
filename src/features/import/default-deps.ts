import { ipc } from '@/lib/ipc';
import type { ImportDeps } from './run-imports';

/** Real import dependencies for the running app. Built lazily (the default is
 *  only evaluated when no deps are injected) so tests and module load don't
 *  touch `ipc()` or the pdf.js worker. */
export function createDefaultImportDeps(): ImportDeps {
  return {
    ipc: ipc(),
    readText: (file) => file.text(),
    extractPdf: async (file) => (await import('./extract-pdf')).extractPdf(file),
    hashFile: (file) => `${file.name}:${file.size}:${file.lastModified}`,
  };
}
