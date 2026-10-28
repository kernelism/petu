import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type PdfDoc = pdfjs.PDFDocumentProxy;

export async function loadPdf(data: ArrayBuffer | string): Promise<PdfDoc> {
  const src = typeof data === 'string' ? { url: data } : { data: new Uint8Array(data) };
  // No eval: PDF fonts are never compiled to JS functions (smaller attack surface, CSP-friendly).
  // fontExtraProperties: fonts keep their /Differences and ToUnicode map, which the math-font text
  // repair reads (src/pdf/mathGlyphs.ts).
  return pdfjs.getDocument({ ...src, isEvalSupported: false, fontExtraProperties: true }).promise;
}
