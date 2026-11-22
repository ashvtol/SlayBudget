import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfTextDto } from '@/lib/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  transform: number[];
}

/** Extract positioned text from a PDF in the webview, grouped into lines by Y.
 *  The structuring into transactions happens in Rust (import_pdf_doc). */
export async function extractPdf(file: File): Promise<PdfTextDto> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const lines: PdfTextDto['lines'] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; text: string }[]>();
    for (const raw of content.items as TextItem[]) {
      if (!('str' in raw)) continue;
      const y = Math.round(raw.transform[5]);
      const x = Math.round(raw.transform[4]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, text: raw.str });
    }
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    for (const [y, items] of sorted) {
      items.sort((a, b) => a.x - b.x);
      lines.push({ y, items });
    }
  }
  return { lines, filename: file.name };
}

export async function hashFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
