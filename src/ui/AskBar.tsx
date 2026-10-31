import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Square, X } from 'lucide-react';
import { Dictation } from '../agent/dictation';
import { BAR_LABEL, PLACEHOLDER, type BarMode } from './barMode';
import { TranscriptPanel, type Transcript } from './Transcript';
import type { LiveTranscript } from './transcriptLive';
import './ui.css';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export type { Transcript };
/** Point-to-ask: what the next question is about (a selection or a circled region), shown as a chip. */
export type About = { label: string; page?: number };

/** Typing this many characters counts as intent to ask (prewarm). */
const INTENT_CHARS = 3;

export function AskBar({ onAsk, onStop, busy, mode = busy ? 'during' : 'ask', showStop = busy, about, onClearAbout, onTyping, onResume, onDismissCheck, onTestYourself, focusSeq, suggestions = [], restore, transcript, live, blocked, onIntent, dictation = true }: {
  onAsk(q: string): void; onStop(): void; busy: boolean;
  /** What the bar means now (src/ui/barMode.ts): its placeholder says which. */
  mode?: BarMode;
  /** The stop button sits in the bar only until the parts row shows (then it is there). */
  showStop?: boolean;
  /** Point-to-ask: the chip "about: … · p.N" before the field; × removes it. */
  about?: About | null;
  onClearAbout?(): void;
  /** The field went from empty to typed (true) or back to empty (false). */
  onTyping?(typing: boolean): void;
  /** Enter on an empty bar while an aside is open: back to the answer. */
  onResume?(): void;
  /** A new value focuses the field (a chip was attached). */
  focusSeq?: number;
  /** Shown as chips above the bar while it is focused and empty. */
  suggestions?: string[];
  /** Puts `text` back into the field (after a failed answer); a new `seq` restores again. */
  restore?: { text: string; seq: number };
  /** The last finished answer: a quiet "Transcript" toggle expands it above the bar. */
  transcript?: Transcript | null;
  /** The answer playing now: the same toggle opens it as it is spoken (it follows the voice; click a sentence to play from it). */
  live?: LiveTranscript | null;
  /** Asking is paused (spending cap): the line shows in place of the placeholder and nothing is sent. */
  blocked?: string;
  /** The student is about to ask: the bar was focused, or the 3rd character was typed. */
  onIntent?(): void;
  /** The mic shows (dictation is set up on the server: GET /api/stt). */
  dictation?: boolean;
  /** Esc with the check question pinned (mode `check`, nothing typed): the question is put away. */
  onDismissCheck?(): void;
  /** The answer offers a check question (p6.2): a quiet "Test yourself" chip opens it. */
  onTestYourself?(): void;
}) {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  useEffect(() => { if (restore) setText(restore.text); }, [restore?.seq]); // eslint-disable-line react-hooks/exhaustive-deps
  // The panel goes with its answer: closed when there is none, and when a new question starts.
  const tQuestion = live?.question ?? transcript?.question ?? null;
  useEffect(() => { setShowTranscript(false); }, [tQuestion]);
  const showRef = useRef(false);
  showRef.current = showTranscript;
  // While an answer plays its caption sits on the bar: the panel opens above the caption, not over it.
  const formRef = useRef<HTMLFormElement>(null);
  const [capH, setCapH] = useState(0);
  useLayoutEffect(() => {
    if (!showTranscript) return;
    const cap = formRef.current?.parentElement?.querySelector<HTMLElement>(':scope > .caption.is-visible');
    const h = cap ? cap.offsetHeight : 0;
    if (h !== capH) setCapH(h);
  });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focusSeq) inputRef.current?.focus(); }, [focusSeq]);
  const typingRef = useRef(false);
  const setTyping = (v: string) => {
    const t = v.trim().length > 0;
    if (t !== typingRef.current) { typingRef.current = t; onTyping?.(t); }
  };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const checkRef = useRef<(() => void) | null>(null);
  checkRef.current = mode === 'check' && onDismissCheck ? onDismissCheck : null;

  // Dictation (src/agent/dictation.ts): the mic fills the field as the student speaks; a pause (or
  // the mic again) sends it, Esc drops it. A failure shows in place of the placeholder for a while.
  // Enter or typing takes the field over: the dictation is dropped (unhooked first, so its onEnd
  // neither sends the question again nor overwrites what was typed).
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState('');
  const dictRef = useRef<Dictation | null>(null);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;
  useEffect(() => () => dictRef.current?.cancel(), []);
  useEffect(() => { if (!micNote) return; const t = setTimeout(() => setMicNote(''), 5000); return () => clearTimeout(t); }, [micNote]);
  const toggleMic = () => {
    if (dictRef.current) { dictRef.current.stop(); return; }
    setMicNote('');
    onIntent?.();
    const d = new Dictation({
      onText: (t) => { if (dictRef.current === d) { setText(t); setTyping(t); } },
      onEnd: ({ text: t, error }) => {
        if (dictRef.current !== d) return;
        dictRef.current = null;
        setListening(false);
        // An error is never a send: what was heard goes back in the field (Enter sends it), the note
        // in the placeholder (empty field) or the field's title.
        if (error) { setMicNote(error); setText(t); setTyping(t); return; }
        if (t.trim()) { typingRef.current = false; onAskRef.current(t.trim()); }
        setText('');
        setTyping('');
      },
    });
    dictRef.current = d;
    setListening(true);
    void d.start();
  };
  const dropMic = () => { const d = dictRef.current; dictRef.current = null; setListening(false); d?.cancel(); };
  const cancelMic = () => { dropMic(); setText(''); setTyping(''); };
  // Nothing can be sent while blocked: the field shows the cap line instead of text that can't go
  // anywhere, and a dictation in progress is dropped (the mic button is gone, its end would send).
  useEffect(() => { if (blocked) { dropMic(); setText(''); } }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape' && showRef.current && !e.defaultPrevented && !isTypingTarget(e.target) && !document.querySelector('.popover')) {
        // An open transcript closes first (mid-answer, Esc would otherwise stop the answer).
        e.preventDefault();
        setShowTranscript(false);
      } else if (e.key === 'Escape' && busyRef.current && !e.defaultPrevented && !isTypingTarget(e.target)) {
        // Esc anywhere stops the answer (the canvas toolbar claims Esc first while drawing).
        onStop();
      } else if (e.key === 'Escape' && checkRef.current && !e.defaultPrevented && !isTypingTarget(e.target) && !document.querySelector('.popover')) {
        // The pinned check question goes first (before Esc reaches the board).
        e.preventDefault();
        checkRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onStop]);

  const submit = () => {
    const q = text.trim();
    if (!q && mode === 'aside') { onResume?.(); return; }
    if (!q || blocked) return;
    dropMic();
    typingRef.current = false;
    onAsk(q);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (listening) cancelMic();
      else if (showTranscript) setShowTranscript(false);
      else if (text) { setText(''); setTyping(''); }
      else if (mode === 'aside') onResume?.();
      else if (busy) onStop();
      else if (mode === 'check' && onDismissCheck) onDismissCheck();
      else e.currentTarget.blur();
    }
  };

  const hasText = text.trim().length > 0;
  const showChips = focused && !hasText && !busy && !blocked && !showTranscript && suggestions.length > 0;
  // Mid-answer the transcript follows the voice; after it, the finished answer. Never during an aside.
  const shownLive = busy && mode !== 'aside' ? live ?? null : null;
  const canTranscript = !hasText && (shownLive ? shownLive.sentences.length > 0 : !!transcript && !busy);

  return (
    <form
      ref={formRef}
      className={`askbar${blocked ? ' is-blocked' : ''}`}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}
      onFocus={() => { if (!focused) onIntent?.(); setFocused(true); }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}
    >
      {showTranscript && canTranscript && (
        <TranscriptPanel transcript={transcript} live={shownLive} bottom={capH ? capH + 10 : undefined} />
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
      {about && (
        <span className="askbar-about" title={`About: ${about.label}${about.page ? ` (page ${about.page})` : ''}`}>
          <span className="askbar-about-text">about: {about.label}{about.page ? ` · p.${about.page}` : ''}</span>
          <button type="button" className="askbar-about-x" onClick={() => { onClearAbout?.(); inputRef.current?.focus(); }} aria-label="Remove what this question is about">
            <X size={12} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </span>
      )}
      {/* Asking is paused (a spending cap): a status row that wraps, in the field's place, never a clipped placeholder. */}
      {blocked && !busy && <p className="askbar-status" role="status">{blocked}</p>}
      <input
        ref={inputRef}
        hidden={!!blocked && !busy}
        className="askbar-input"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (dictRef.current) dropMic();
          if (v.trim().length >= INTENT_CHARS && text.trim().length < INTENT_CHARS) onIntent?.();
          setText(v);
          setTyping(v);
        }}
        onKeyDown={onKeyDown}
        placeholder={listening ? 'Listening…' : micNote || PLACEHOLDER[mode]}
        readOnly={!!blocked && !busy}
        title={micNote || undefined}
        aria-label={BAR_LABEL[mode]}
        autoComplete="off"
        spellCheck={false}
      />
      {onTestYourself && !hasText && !busy && (
        <button
          type="button"
          className="askbar-transcript askbar-test"
          onClick={() => { setShowTranscript(false); onTestYourself(); }}
          title="A question to check yourself on this answer"
        >
          Test yourself
        </button>
      )}
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
      {!blocked && dictation && (
        <button
          type="button"
          className={`askbar-mic${listening ? ' is-listening' : ''}`}
          onClick={toggleMic}
          // Clicking moves focus here: Esc drops the dictation (before the window's Esc stops the answer).
          onKeyDown={(e) => { if (e.key === 'Escape' && listening) { e.preventDefault(); cancelMic(); } }}
          aria-pressed={listening}
          aria-label={listening ? 'Stop and send what you said' : 'Ask by voice'}
          title={listening ? 'Stop and send (Esc drops it)' : 'Ask by voice'}
        >
          <Mic size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      <div className="askbar-trail">
        {/* While listening the mic is the send; the answer's stop stays. */}
        {hasText && !blocked && !listening ? (
          <button type="submit" className="askbar-btn is-send" aria-label={mode === 'check' ? 'Send your answer' : 'Ask'}>
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        ) : busy && showStop ? (
          <button type="button" className="askbar-btn is-stop" onClick={onStop} aria-label="Stop answer">
            <Square size={12} strokeWidth={0} fill="currentColor" />
          </button>
        ) : listening ? null : (
          <kbd className="keycap" aria-hidden="true">/</kbd>
        )}
      </div>
    </form>
  );
}
