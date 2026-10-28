import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import './ui.css';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export type Transcript = { question: string; answer: string };

/** Typing this many characters counts as intent to ask (prewarm). */
const INTENT_CHARS = 3;

export function AskBar({ onAsk, onStop, busy, suggestions = [], restore, transcript, blocked, onIntent }: {
  onAsk(q: string): void; onStop(): void; busy: boolean;
  /** Shown as chips above the bar while it is focused and empty. */
  suggestions?: string[];
  /** Puts `text` back into the field (after a failed answer); a new `seq` restores again. */
  restore?: { text: string; seq: number };
  /** The last finished answer: a quiet "Transcript" toggle expands it above the bar. */
  transcript?: Transcript | null;
  /** Asking is paused (spending cap): the line shows in place of the placeholder and nothing is sent. */
  blocked?: string;
  /** The student is about to ask: the bar was focused, or the 3rd character was typed. */
  onIntent?(): void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  useEffect(() => { if (restore) setText(restore.text); }, [restore?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!transcript || busy) setShowTranscript(false); }, [transcript, busy]);
  // Nothing can be sent while blocked: the field shows the cap line instead of text that can't go anywhere.
  useEffect(() => { if (blocked) setText(''); }, [blocked]);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && busyRef.current && !e.defaultPrevented && !isTypingTarget(e.target)) {
        // Esc anywhere stops the answer (the canvas toolbar claims Esc first while drawing).
        onStop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStop]);

  const submit = () => {
    const q = text.trim();
    if (!q || blocked) return;
    onAsk(q);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (showTranscript) setShowTranscript(false);
      else if (busy) onStop();
      else e.currentTarget.blur();
    }
  };

  const hasText = text.trim().length > 0;
  const showChips = focused && !hasText && !busy && !blocked && !showTranscript && suggestions.length > 0;
  const canTranscript = !!transcript && !busy && !hasText;

  return (
    <form
      className={`askbar${blocked ? ' is-blocked' : ''}`}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}
      onFocus={() => { if (!focused) onIntent?.(); setFocused(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      {showTranscript && transcript && (
        <section className="transcript" aria-label="Transcript" onMouseDown={(e) => e.stopPropagation()}>
          <p className="transcript-q">{transcript.question}</p>
          <p className="transcript-a">{transcript.answer}</p>
        </section>
      )}
      {showChips && (
        <div className="askbar-chips" role="group" aria-label="Suggested questions">
          {suggestions.map((q) => (
            <button
              key={q}
              type="button"
              className="askbar-chip"
              // Keep focus in the bar on pointer press, so the chips don't vanish before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onAsk(q); inputRef.current?.blur(); }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="askbar-input"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (v.trim().length >= INTENT_CHARS && text.trim().length < INTENT_CHARS) onIntent?.();
          setText(v);
        }}
        onKeyDown={onKeyDown}
        placeholder={busy ? 'Answering · Esc to stop' : blocked ?? 'Ask about this PDF…'}
        // Blocked: still focusable (the line can be read, Esc and / work), but nothing can be typed or sent.
        readOnly={!!blocked && !busy}
        title={blocked && !busy ? blocked : undefined}
        aria-label="Ask about this PDF"
        autoComplete="off"
        spellCheck={false}
      />
      {canTranscript && (
        <button
          type="button"
          className="askbar-transcript"
          aria-expanded={showTranscript}
          onClick={() => setShowTranscript((o) => !o)}
        >
          {showTranscript ? 'Hide transcript' : 'Transcript'}
        </button>
      )}
      <div className="askbar-trail">
        {busy ? (
          <button type="button" className="askbar-btn is-stop" onClick={onStop} aria-label="Stop answer">
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        ) : hasText && !blocked ? (
          <button type="submit" className="askbar-btn is-send" aria-label="Ask">
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        ) : (
          <kbd className="keycap" aria-hidden="true">/</kbd>
        )}
      </div>
    </form>
  );
}
