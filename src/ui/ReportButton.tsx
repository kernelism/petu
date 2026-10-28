// src/ui/ReportButton.tsx — the top bar's Report control (also Shift+R outside text fields).
// Clicking captures at once (the state the tester is looking at), then offers a one-line optional
// note: Enter saves, Esc cancels. A short static line says where it went.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag } from 'lucide-react';
import './ui.css';

/** Captures now; the returned function saves the capture with a note and resolves to the saved dir. */
export type Capture = () => Promise<(note: string) => Promise<string>>;

type Phase = { k: 'idle' } | { k: 'capturing' } | { k: 'note'; save: (note: string) => Promise<string> } | { k: 'saving' } | { k: 'done'; line: string; error?: boolean };

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

export function ReportButton({ capture }: { capture: Capture }) {
  const [phase, setPhase] = useState<Phase>({ k: 'idle' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const doneTimer = useRef<number>();

  const start = useCallback(async () => {
    if (phaseRef.current.k !== 'idle' && phaseRef.current.k !== 'done') return;
    window.clearTimeout(doneTimer.current);
    setPhase({ k: 'capturing' });
    try {
      const save = await capture();
      setPhase({ k: 'note', save });
    } catch (e) {
      console.warn('[report] capture failed', e);
      finish("Couldn't capture the report.", true);
    }
  }, [capture]);

  const finish = (line: string, error = false) => {
    setPhase({ k: 'done', line, error });
    window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => setPhase({ k: 'idle' }), error ? 6000 : 3500);
  };

  const submit = async (note: string) => {
    const p = phaseRef.current;
    if (p.k !== 'note') return;
    setPhase({ k: 'saving' });
    try { finish(`Saved to ${await p.save(note)}`); }
    catch (e) { console.warn('[report] save failed', e); finish("Couldn't save the report.", true); }
    btnRef.current?.focus();
  };

  const cancel = () => { setPhase({ k: 'idle' }); btnRef.current?.focus(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'R' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      void start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);
  useEffect(() => { if (phase.k === 'note') inputRef.current?.focus(); }, [phase.k]);
  useEffect(() => () => window.clearTimeout(doneTimer.current), []);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        onClick={() => void start()}
        aria-label="Report a problem (Shift+R)"
        title="Report a problem (Shift+R)"
        aria-expanded={phase.k === 'note'}
        data-report=""
      >
        <Flag size={17} strokeWidth={1.75} />
      </button>
      {phase.k !== 'idle' && (
        <div className="report-pop" role={phase.k === 'done' ? 'status' : undefined}>
          {phase.k === 'note' || phase.k === 'saving' ? (
            <input
              ref={inputRef}
              className="report-input"
              placeholder="What went wrong? (optional) — Enter saves"
              aria-label="Report note (optional). Enter saves, Escape cancels."
              maxLength={2000}
              disabled={phase.k === 'saving'}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void submit(e.currentTarget.value); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
              }}
            />
          ) : (
            <span className={`report-line${phase.k === 'done' && phase.error ? ' is-error' : ''}`}>
              {phase.k === 'capturing' ? 'Capturing…' : phase.line}
            </span>
          )}
        </div>
      )}
    </>
  );
}
