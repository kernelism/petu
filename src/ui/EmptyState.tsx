import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import './ui.css';

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
      <div className="empty-card">
        <FileText className="empty-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
        <h1 className="empty-title">Drop a PDF to start</h1>
        <p className="empty-sub">or choose a file</p>
        <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
          Choose PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
        />
        <button type="button" className="btn-quiet" onClick={onSample}>
          Try the sample deck
        </button>
        <p className="empty-error" role="alert">{shownError ?? ''}</p>
      </div>
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
    </div>
  );
}
