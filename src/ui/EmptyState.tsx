import { useEffect, useRef, useState } from 'react';
import { CircleDashed, FileText, MessageSquareText, PenLine } from 'lucide-react';
import './ui.css';

const NOT_PDF = "That doesn't look like a PDF.";
/** The first sample on offer: a general-interest deck (the stereo-vision one is the scripted demo's). */
const ECON_SAMPLE = { url: '/fixtures/econ.pdf', name: 'Economics — sample.pdf' };
/** The three verbs show once, on the very first visit. */
const WELCOME_KEY = 'pdf-tutor.welcomed';
const welcomed = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return true; } };
const markWelcomed = () => { try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* private mode */ } };
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

  // Open the economics sample as if it were dropped: a plain document, no scripted demo.
  const [fetching, setFetching] = useState(false);
  const openEcon = async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const r = await fetch(ECON_SAMPLE.url);
      if (!r.ok) throw new Error(String(r.status));
      take(new File([await r.blob()], ECON_SAMPLE.name, { type: 'application/pdf' }));
    } catch {
      setLocalError("The sample couldn't be opened.");
    } finally {
      setFetching(false);
    }
  };
  const [firstRun] = useState(() => !welcomed());
  useEffect(() => markWelcomed, []);

  const shownError = localError ?? error;

  return (
    <div className={`empty${dragging ? ' is-dragging' : ''}`}>
      <div className="empty-card">
        <FileText className="empty-icon" size={28} strokeWidth={1.5} aria-hidden="true" />
        <h1 className="empty-title">Ask about a PDF and see the answer drawn on the page.</h1>
        {firstRun && (
          <ol className="empty-verbs" aria-label="How it works">
            <li><MessageSquareText size={16} strokeWidth={1.75} aria-hidden="true" />Ask</li>
            <li><CircleDashed size={16} strokeWidth={1.75} aria-hidden="true" />Circle what you mean</li>
            <li><PenLine size={16} strokeWidth={1.75} aria-hidden="true" />Watch it drawn</li>
          </ol>
        )}
        <button type="button" className="btn-primary" onClick={() => inputRef.current?.click()}>
          Open a PDF
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
        />
        <p className="empty-drop">or drop one anywhere on this page</p>
        <div className="empty-samples">
          <span className="empty-samples-label" id="empty-samples">Try a sample:</span>
          <button type="button" className="btn-quiet" aria-describedby="empty-samples" onClick={() => void openEcon()} disabled={fetching}>
            Economics
          </button>
          <span className="empty-samples-sep" aria-hidden="true">·</span>
          <button type="button" className="btn-quiet" aria-describedby="empty-samples" onClick={onSample}>
            Stereo vision
          </button>
        </div>
        <p className="empty-error" role="alert">{shownError ?? ''}</p>
      </div>
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
    </div>
  );
}
