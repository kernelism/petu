// tests/pdf/renderer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { PageRenderer } from '../../src/pdf/PdfViewer';
import type { PdfDoc } from '../../src/pdf/loadPdf';

/** A document destroyed under the viewer (unmount, HMR): getPage throws synchronously, as pdf.js does. */
function deadDoc() {
  const getPage = vi.fn(() => { throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')"); });
  return { doc: { numPages: 3, getPage, loadingTask: { destroyed: true } } as unknown as PdfDoc, getPage };
}

describe('PageRenderer teardown', () => {
  it('release and destroy never touch a destroyed document', async () => {
    const { doc, getPage } = deadDoc();
    const r = new PageRenderer(doc, () => undefined, () => 1, () => {});
    // Give it page state as if pages had been rendered.
    (r as unknown as { states: Map<number, unknown> }).states.set(1, { canvas: null, key: 'k', task: null, taskKey: '' });
    (r as unknown as { states: Map<number, unknown> }).states.set(2, { canvas: null, key: 'k', task: null, taskKey: '' });
    expect(() => r.release(1)).not.toThrow();
    expect(() => r.destroy()).not.toThrow();
    expect(getPage).not.toHaveBeenCalled();
    await Promise.resolve();
  });
  it('a render after the document is gone fails quietly', async () => {
    const { doc } = deadDoc();
    const r = new PageRenderer(doc, () => undefined, () => 1, () => {});
    r.renderW = 800;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => r.setNear(1, true)).not.toThrow();
    await new Promise((res) => setTimeout(res, 0));
    warn.mockRestore();
  });
});
