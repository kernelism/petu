// src/ui/DeeperInset.tsx
import { useEffect, useRef, useState } from 'react';
import { CornerDownRight, X } from 'lucide-react';
import { joinWords } from './Caption';
import './ui.css';

/**
 * "Go deeper" on one part (one level only): the main answer waits, paused, with its board as it is;
 * the follow-up's narration plays here; Return (or Esc) closes the inset and the answer resumes
 * from the word where it paused.
 */
export type Deeper = {
  /** The part's title. */
  title: string;
  /** The follow-up asked, once asked. */
  question?: string;
  words: string[];
  state: 'ask' | 'thinking' | 'playing' | 'done' | 'error';
  error?: string;
};

type Props = { deeper: Deeper; onAsk(q: string): void; onClose(): void };

export function DeeperInset({ deeper, onAsk, onClose }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (deeper.state === 'ask') inputRef.current?.focus(); }, [deeper.state]);
  const body = joinWords(deeper.words);
  return (
    <section className="deeper" aria-label={`Going deeper: ${deeper.title}`}>
      <header className="deeper-head">
        <CornerDownRight size={14} strokeWidth={2} aria-hidden="true" />
        <span className="deeper-title">Going deeper · {deeper.title}</span>
        <button type="button" className="deeper-close" onClick={onClose} title="Back to the answer (Esc)">
          Back to the answer
          <X size={13} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </header>
      {deeper.state === 'ask' ? (
        <form className="deeper-ask" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (q) onAsk(q); }}>
          <input
            ref={inputRef}
            className="deeper-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What would you like to dig into here?"
            aria-label="Follow-up about this part"
          />
        </form>
      ) : (
        <>
          {deeper.question && <div className="deeper-q">{deeper.question}</div>}
          <div className="deeper-text" aria-live="polite">
            {deeper.state === 'error' ? <span className="deeper-error">{deeper.error}</span>
              : body ? body : <span className="deeper-think" aria-hidden="true">…</span>}
          </div>
        </>
      )}
    </section>
  );
}
