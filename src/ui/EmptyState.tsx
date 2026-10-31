import { useEffect, useRef, useState } from 'react';
import { Specimen } from './Specimen';
import './ui.css';
import './landing.css';

const NOT_PDF = "That doesn't look like a PDF.";
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

export function EmptyState({ onFile, onSample, error }: { onFile(f: File): void; onSample(): void; error?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<string | undefined>();

  const take = (f: File | undefined) => {
    if (!f) return;
    if (!isPdf(f)) { setLocalError(NOT_PDF); return; }
    setLocalError(undefined);
    onFile(f);
  };
  const takeRef = useRef(take);
  takeRef.current = take;

  // Window-level drag and drop. dragenter/dragleave fire per child element, so count depth.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      takeRef.current(e.dataTransfer!.files[0]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const shownError = localError ?? error;

  return (
    <div className={`empty${dragging ? ' is-dragging' : ''}`}>
      <main className="land">
        <p className="land-mark">petu</p>
        <section className="land-copy">
          <h1 className="land-title">Ask your slides a question.</h1>
          <p className="land-lede">
            petu answers out loud and draws as it explains: it marks the line on the page that matters,
            then works the answer out on a board beside it.
          </p>
          <div className="land-actions">
            <button type="button" className="btn-primary land-open" onClick={() => inputRef.current?.click()}>
              Open a PDF
            </button>
            <button type="button" className="btn-quiet land-sample" onClick={onSample}>
              Try the sample deck
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
          />
          <p className="land-hint">Or drop a PDF anywhere on this page. Lecture slides work best.</p>
          <p className="empty-error" role="alert">{shownError ?? ''}</p>
        </section>
        <Specimen />
      </main>
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
    </div>
  );
}
