// Temporary harness for Task 5 (Task 7 replaces this file).
// ?src=/fixtures/x.pdf loads by URL; &goto=N calls api.scrollToPage(N) once ready.
import { useEffect, useState } from 'react';
import { loadPdf, type PdfDoc } from './pdf/loadPdf';
import { PdfViewer } from './pdf/PdfViewer';
import type { ViewerApi } from './pdf/viewerApi';

declare global {
  interface Window { __viewer?: ViewerApi }
}

const params = new URLSearchParams(location.search);

export default function App() {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    const src = params.get('src');
    if (src) loadPdf(src).then(setDoc, (e) => setError(String(e)));
  }, []);
  useEffect(() => () => { void doc?.destroy(); }, [doc]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try { setDoc(await loadPdf(await f.arrayBuffer())); } catch (e) { setError(String(e)); }
  };

  const onReady = (api: ViewerApi) => {
    if (import.meta.env.DEV) window.__viewer = api;
    const goto = Number(params.get('goto'));
    if (goto) {
      const t0 = performance.now();
      void api.scrollToPage(goto).then(() => {
        document.title = `landed p${api.currentPage()} in ${Math.round(performance.now() - t0)}ms`;
        console.info(document.title);
      });
    }
  };

  return (
    <>
      {doc && <PdfViewer doc={doc} onReady={onReady} onPageChange={setPage} />}
      <div style={{ position: 'fixed', top: 16, left: 16, display: 'flex', gap: 12, alignItems: 'center', font: '13px system-ui', zIndex: 10 }}>
        <input type="file" accept="application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
        {doc && <span>Page {page} / {doc.numPages}</span>}
        {error && <span style={{ color: '#b00' }}>{error}</span>}
      </div>
    </>
  );
}
