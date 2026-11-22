import type { ImportReport, PdfTextDto } from '@/lib/types';
import type { Ipc } from '@/lib/ipc';

export type ImportKind = 'csv' | 'ofx' | 'pdf' | 'unsupported';

export function classifyFile(name: string): ImportKind {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.ofx') || lower.endsWith('.qfx')) return 'ofx';
  if (lower.endsWith('.pdf')) return 'pdf';
  return 'unsupported';
}

/** Relative path used for source detection: folder uploads expose webkitRelativePath. */
export function importPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return rel && rel.length > 0 ? rel : file.name;
}

export interface ImportDeps {
  ipc: Ipc;
  readText(file: File): Promise<string>;
  extractPdf(file: File): Promise<PdfTextDto>;
  hashFile(file: File): string;
}

export interface FileResult {
  name: string;
  report?: ImportReport;
  error?: string;
}

/** Import a batch of files into one profile, reporting progress per file.
 *  Unsupported files and failures are collected, never thrown, so one bad file
 *  does not abort the batch. */
export async function runImports(
  files: File[],
  profileId: number,
  deps: ImportDeps,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<FileResult[]> {
  const results: FileResult[] = [];
  let done = 0;
  for (const file of files) {
    onProgress?.(done, files.length, file.name);
    const kind = classifyFile(file.name);
    const path = importPath(file);
    try {
      let report: ImportReport;
      if (kind === 'csv') {
        report = await deps.ipc.importCsvText(profileId, path, await deps.readText(file));
      } else if (kind === 'ofx') {
        report = await deps.ipc.importOfxText(profileId, path, await deps.readText(file));
      } else if (kind === 'pdf') {
        report = await deps.ipc.importPdfDoc(profileId, path, await deps.extractPdf(file), deps.hashFile(file));
      } else {
        results.push({ name: file.name, error: 'Unsupported file type' });
        done++;
        continue;
      }
      results.push({ name: file.name, report });
    } catch (e) {
      results.push({ name: file.name, error: e instanceof Error ? e.message : String(e) });
    }
    done++;
    onProgress?.(done, files.length, file.name);
  }
  return results;
}

export function summarize(results: FileResult[]): { imported: number; duplicates: number; failed: number } {
  let imported = 0;
  let duplicates = 0;
  let failed = 0;
  for (const r of results) {
    if (r.error) failed++;
    else if (r.report) {
      imported += r.report.inserted;
      duplicates += r.report.duplicates;
    }
  }
  return { imported, duplicates, failed };
}
