// src/ui/SessionDrawer.tsx — the session list (layout C, spec §5.5; founder 2026-10-31): a left drawer,
// 280 px, toggled with S or the top bar's list button, closed until asked for. One row per question
// (a conversation: the first question, its follow-ups and asides, on one board), by its title, in time
// order; the one on the board is tinted. Picking a row brings its board back. A row with follow-ups or
// asides opens to list them.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RowLine } from '../session/conversations';
import './session.css';

export type SessionRow = { id: number; title: string; lines: RowLine[]; current: boolean };

type Props = { open: boolean; rows: SessionRow[]; onPick(id: number): void; onClose(): void };

export function SessionDrawer({ open, rows, onPick, onClose }: Props) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  // Opening moves focus into the list (keyboard users land on it); S or Esc closes.
  // An empty list: the drawer itself takes focus, so Esc still closes it.
  useEffect(() => { if (open) (ref.current?.querySelector<HTMLButtonElement>('.session-row.is-current') ?? ref.current?.querySelector<HTMLButtonElement>('.session-row') ?? ref.current)?.focus({ preventScroll: true }); }, [open]);
  const toggle = (id: number) => setShown((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <aside ref={ref} tabIndex={-1} className={`session${open ? ' is-open' : ''}`} aria-label="Questions" aria-hidden={!open}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <header className="session-head">
        <h2 className="session-title">Questions</h2>
      </header>
      {rows.length === 0 && <p className="session-empty">Questions you ask appear here, in order.</p>}
      <ol className="session-list">
        {rows.map((r) => {
          const opened = shown.has(r.id) && r.lines.length > 0;
          return (
            <li key={r.id} className={`session-item${r.current ? ' is-current' : ''}`}>
              <div className="session-line">
                <button type="button" className={`session-row${r.current ? ' is-current' : ''}`} onClick={() => onPick(r.id)} aria-current={r.current || undefined}>
                  <span className="session-q">{r.title}</span>
                </button>
                {r.lines.length > 0 && (
                  <button type="button" className={`session-more${opened ? ' is-open' : ''}`} onClick={() => toggle(r.id)} aria-expanded={opened} aria-label={opened ? 'Hide its follow-ups' : 'Show its follow-ups'}>
                    <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
              {opened && (
                <ul className="session-sub">
                  {r.lines.map((l, k) => <li key={k} className={l.aside ? 'is-aside' : undefined}>{l.text}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
