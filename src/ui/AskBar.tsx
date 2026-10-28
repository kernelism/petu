import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import './ui.css';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function AskBar({ onAsk, onStop, busy }: { onAsk(q: string): void; onStop(): void; busy: boolean }) {
  const [text, setText] = useState('');
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
    if (!q) return;
    onAsk(q);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (busy) onStop();
      else e.currentTarget.blur();
    }
  };

  const hasText = text.trim().length > 0;

  return (
    <form
      className="askbar"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}
    >
      <input
        ref={inputRef}
        className="askbar-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={busy ? 'Answering · Esc to stop' : 'Ask about this PDF…'}
        aria-label="Ask about this PDF"
        autoComplete="off"
        spellCheck={false}
      />
      <div className="askbar-trail">
        {busy ? (
          <button type="button" className="askbar-btn is-stop" onClick={onStop} aria-label="Stop answer">
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        ) : hasText ? (
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
