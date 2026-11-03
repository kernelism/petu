import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Square, X } from 'lucide-react';
import { Dictation } from '../agent/dictation';
import { BAR_LABEL, PLACEHOLDER, type BarMode } from './barMode';
import { TranscriptPanel, type Transcript } from './Transcript';
import type { LiveTranscript } from './transcriptLive';
import './ui.css';
import { setTypeSink } from './typeAhead';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export type { Transcript };
/**
 * Point-to-ask: what the next question is about, one chip each: a selection ("about: … · p.N"), or a
 * mark the student drew since the last question ("your underline · p.88"; `title`: what it is on).
 */
export type About = { key: string; label: string; page?: number; title?: string };

/** The placeholder while Enter on the empty bar asks `emptyAsk`. */
export const EMPTY_ASK_HINT = 'Enter: explain this, or ask…';

/** Typing this many characters counts as intent to ask (prewarm). */
const INTENT_CHARS = 3;
/** The field grows with its question up to this many lines, then scrolls inside (newest words in view). */
export const MAX_LINES = 5;
/** The speak key (V for voice): held this long it is hold-to-talk (release sends); a shorter tap toggles. */
export const HOLD_MS = 350;

/** V, outside a field, no modifiers, no popover open: the speak shortcut (Shortcuts card "Ask by voice"). */
export function isSpeakKey(e: Pick<globalThis.KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>): boolean {
  return (e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target) && !document.querySelector('.popover');
}

export function AskBar({ onAsk, onStop, busy, mode = busy ? 'during' : 'ask', showStop = busy, about = [], onClearAbout, emptyAsk, onTyping, onResume, onDismissCheck, onTestYourself, focusSeq, suggestions = [], restore, transcript, live, blocked, onIntent, dictation = true }: {
  onAsk(q: string): void; onStop(): void; busy: boolean;
  /** What the bar means now (src/ui/barMode.ts): its placeholder says which. */
  mode?: BarMode;
  /** The stop button sits in the bar only until the parts row shows (then it is there). */
  showStop?: boolean;
  /** Point-to-ask: the chips ("about: … · p.N") before the field; × removes one. */
  about?: About[];
  onClearAbout?(key: string): void;
  /** Enter on an empty bar asks this (a "?" drawn: "Explain this."); the placeholder says so. */
  emptyAsk?: string;
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
  /**
   * A question sent: focus leaves the bar (to the page), so the answer's shortcuts (Space, R, < >, Z,
   * M, D, S, ⌘±) act at once and none of their characters lands in the field as the next question.
   * / or a click brings the field back.
   */
  const release = () => {
    const a = document.activeElement;
    if (a instanceof HTMLElement && formRef.current?.contains(a)) a.blur();
  };
  const releaseRef = useRef(release);
  releaseRef.current = release;
  const [capH, setCapH] = useState(0);
  useLayoutEffect(() => {
    if (!showTranscript) return;
    const cap = formRef.current?.parentElement?.querySelector<HTMLElement>(':scope > .caption.is-visible');
    const h = cap ? cap.offsetHeight : 0;
    if (h !== capH) setCapH(h);
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (focusSeq) inputRef.current?.focus(); }, [focusSeq]);
  // Typing with the bar unfocused (ui/typeAhead.ts): the text lands here, the bar focused, as if typed in it.
  const textRef = useRef(text);
  textRef.current = text;
  const sinkOk = useRef(true);
  sinkOk.current = !(blocked && !busy);
  useEffect(() => {
    setTypeSink((t) => {
      const el = inputRef.current;
      if (!el || !sinkOk.current) return false;
      const v = textRef.current + t;
      el.focus();
      textRef.current = v;
      setText(v);
      setTyping(v);
      return true;
    });
    return () => setTypeSink(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const typingRef = useRef(false);
  const setTyping = (v: string) => {
    const t = v.trim().length > 0;
    if (t !== typingRef.current) { typingRef.current = t; onTyping?.(t); }
  };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const checkRef = useRef<(() => void) | null>(null);
  checkRef.current = mode === 'check' && onDismissCheck ? onDismissCheck : null;

  // Dictation (src/agent/dictation.ts): the mic (or V) fills the field as the student speaks; a pause
  // shows "Sending…" for a moment (more speech or any key cancels it) and then sends; the mic, V or
  // Enter sends at once, Esc drops it. A failure shows in place of the placeholder for a while.
  // Typing takes the field over: the dictation is dropped (unhooked first, so its onEnd neither sends
  // the question nor overwrites what was typed) and the words stay to edit. Mid-answer, starting to
  // listen pauses the answer, as typing does; the question then goes the usual way (an aside).
  const [listening, setListening] = useState(false);
  /** The pause's countdown: the question goes in this many ms (null: none running). */
  const [sendIn, setSendIn] = useState<number | null>(null);
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
    // Mid-answer, listening pauses the answer at once (as the first typed character does).
    if (busyRef.current && !typingRef.current) { typingRef.current = true; onTyping?.(true); }
    const d = new Dictation({
      onText: (t) => { if (dictRef.current === d) { setText(t); if (t.trim()) setTyping(t); } },
      onCountdown: (ms) => { if (dictRef.current === d) setSendIn(ms); },
      onEnd: ({ text: t, error }) => {
        if (dictRef.current !== d) return;
        dictRef.current = null;
        setListening(false);
        setSendIn(null);
        // An error is never a send: what was heard goes back in the field (Enter sends it), the note
        // in the placeholder (empty field) or the field's title.
        if (error) { setMicNote(error); setText(t); setTyping(t); return; }
        if (t.trim()) { typingRef.current = false; onAskRef.current(t.trim()); releaseRef.current(); }
        setText('');
        setTyping('');
      },
    });
    dictRef.current = d;
    setListening(true);
    void d.start();
  };
  const dropMic = () => { const d = dictRef.current; dictRef.current = null; setListening(false); setSendIn(null); d?.cancel(); };
  const toggleMicRef = useRef(toggleMic);
  toggleMicRef.current = toggleMic;
  const dictationRef = useRef(dictation && !blocked);
  dictationRef.current = dictation && !blocked;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const cancelMic = () => { dropMic(); setText(''); setTyping(''); };
  const cancelMicRef = useRef(cancelMic);
  cancelMicRef.current = cancelMic;
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

  // V: tap to start or stop (stop sends), hold to talk (release sends). While listening, Enter outside
  // the field sends at once and any other key holds the pause's countdown. Without dictation set up
  // (no SPEECHMATICS_API_KEY) V only says so, briefly.
  useEffect(() => {
    let pressed: { at: number; started: boolean } | null = null;
    const onDown = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // A typed draft (not a dictation's own words) is never replaced by V: it is a letter of the question.
      if (isSpeakKey(e) && (dictRef.current || !typingRef.current)) {
        e.preventDefault();
        if (e.repeat || pressed) return;
        if (!dictationRef.current) { if (!blockedRef.current) setMicNote('Voice questions are not set up here.'); return; }
        const started = !dictRef.current;
        pressed = { at: performance.now(), started };
        toggleMicRef.current();
        return;
      }
      const d = dictRef.current;
      if (!d) return;
      // Esc drops what was heard (before the window's Esc would stop the answer); the field's own Esc does the same.
      if (e.key === 'Escape' && !isTypingTarget(e.target) && !document.querySelector('.popover')) { e.preventDefault(); e.stopPropagation(); cancelMicRef.current(); return; }
      if (e.key === 'Enter' && !isTypingTarget(e.target) && !e.isComposing) { e.preventDefault(); e.stopPropagation(); d.stop(); return; }
      if (!['Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(e.key)) d.hold();
    };
    const onUp = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'v' && e.key !== 'V') return;
      const p = pressed;
      pressed = null;
      // Held: hold-to-talk, the release sends. A tap leaves it listening (V again, Enter or the pause sends).
      if (p?.started && performance.now() - p.at >= HOLD_MS) dictRef.current?.stop();
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, []);

  // The field grows with its question (one line up to MAX_LINES, then it scrolls inside), and shrinks
  // back once sent. Dictated words arrive at the end: the newest stay in view.
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const max = line * MAX_LINES + pad;
    // Empty, it is one line whatever the placeholder says (a long note never grows the bar).
    const h = text ? Math.max(line + pad, Math.min(el.scrollHeight, max)) : line + pad;
    el.style.height = `${h}px`;
    el.style.overflowY = text && el.scrollHeight > max + 1 ? 'auto' : 'hidden';
    if (listening) el.scrollTop = el.scrollHeight;
    const isTall = h > line + pad + 1;
    if (isTall !== tall) setTall(isTall);
  }, [text, listening, tall]);

  const submit = () => {
    const q = text.trim() || (emptyAsk && !listening ? emptyAsk : '');
    if (!q && mode === 'aside') { onResume?.(); release(); return; }
    if (!q || blocked) return;
    dropMic();
    typingRef.current = false;
    onAsk(q);
    setText('');
    release();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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

  const chipEls = about.map((a, i) => (
    <span key={a.key} className="askbar-about" title={a.title ?? `About: ${a.label}${a.page ? ` (page ${a.page})` : ''}`}>
      <span className="askbar-about-text">{i ? '' : 'about: '}{a.label}{a.page ? ` · p.${a.page}` : ''}</span>
      <button type="button" className="askbar-about-x" onClick={() => { onClearAbout?.(a.key); inputRef.current?.focus(); }} aria-label={`Remove ${a.label} from this question`}>
        <X size={12} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </span>
  ));

  return (
    <form
      ref={formRef}
      className={`askbar${blocked ? ' is-blocked' : ''}${tall ? ' is-tall' : ''}${hasText ? ' has-draft' : ''}${about.length > 1 ? ' has-chips' : ''}`}
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
      {about.length > 1
        // Several marks: their own wrapping row above the field (each chip whole, each removable).
        ? <div className="askbar-abouts" role="group" aria-label="What this question is about">{chipEls}</div>
        : chipEls}
      {/* Asking is paused (a spending cap): a status row that wraps, in the field's place, never a clipped placeholder. */}
      {blocked && !busy && <p className="askbar-status" role="status">{blocked}</p>}
      <textarea
        ref={inputRef}
        rows={1}
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
        placeholder={listening ? 'Listening…' : micNote || (emptyAsk && !blocked ? EMPTY_ASK_HINT : PLACEHOLDER[mode])}
        readOnly={!!blocked && !busy}
        title={micNote || undefined}
        aria-label={BAR_LABEL[mode]}
        autoComplete="off"
        spellCheck={false}
      />
      {sendIn != null && (
        <span className="askbar-sending" role="status" title="Keep talking, or press any key, to wait" style={{ '--send-in': `${sendIn}ms` } as CSSProperties}>
          Sending…
        </span>
      )}
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
          aria-keyshortcuts="V"
          title={listening ? 'Stop and send (V · Esc drops it)' : 'Ask by voice (V, or hold V to talk)'}
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
