// src/ui/SessionDrawer.tsx — the session list (layout C, spec §5.5; mockup C5): a left drawer, 280 px,
// toggled with S. Questions in time order with where they were asked and how long they played, the
// asides under the answer they interrupted. Picking one jumps to its card in the lane and opens it.
import { useEffect, useRef } from 'react';
import './session.css';

export type SessionRow = { num: string; title: string; meta: string; asides: string[]; current: boolean };

type Props = { open: boolean; rows: SessionRow[]; total: string; onPick(i: number): void; onClose(): void };

export function SessionDrawer({ open, rows, total, onPick, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);
  // Opening moves focus into the list (keyboard users land on it); S or Esc closes.
  useEffect(() => { if (open) (ref.current?.querySelector<HTMLButtonElement>('.session-row.is-current') ?? ref.current?.querySelector<HTMLButtonElement>('.session-row'))?.focus({ preventScroll: true }); }, [open]);
  return (
    <aside ref={ref} className={`session${open ? ' is-open' : ''}`} aria-label="Session" aria-hidden={!open}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="session-head">
        <h2 className="session-title">Session</h2>
        <p className="session-sub">{rows.length} {rows.length === 1 ? 'question' : 'questions'}{total ? ` · ${total}` : ''} · S to close</p>
      </header>
      {rows.length === 0 && <p className="session-empty">Questions you ask appear here, in order.</p>}
      <ol className="session-list">
        {rows.map((r, i) => (
          <li key={i}>
            <button type="button" className={`session-row${r.current ? ' is-current' : ''}`} onClick={() => onPick(i)}>
              <span className="session-num" aria-hidden="true">{r.num}</span>
              <span className="session-body">
                <span className="session-q">{r.title}</span>
                {r.meta && <span className="session-meta">{r.meta}</span>}
                {r.asides.map((a, k) => <span key={k} className="session-aside">Aside: {a}</span>)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}
