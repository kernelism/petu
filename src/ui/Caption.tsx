import { useLayoutEffect, useRef, useState } from 'react';
import { primes } from './text';
import { countLines, windowStart } from './captionWindow';
import './ui.css';

const PUNCT_ONLY = /^[\p{P}…]+$/u;

/** Display tokens: punctuation-only tokens are glued to the previous word. */
export function groupWords(words: string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (!w) continue;
    if (out.length && PUNCT_ONLY.test(w)) out[out.length - 1] += w;
    else out.push(w);
  }
  return out.map(primes);
}

/** Joins caption words with spaces, gluing punctuation-only tokens ("x" + "." → "x."). */
export const joinWords = (words: string[]): string => groupWords(words).join(' ');

type Props = {
  words: string[];
  visible: boolean;
  /** The asked question, echoed as a quiet line above the narration while answering. */
  question?: string;
  /** Between Enter and the first word: the echoed question waits, muted. */
  waiting?: boolean;
  /** A quiet status line while no word has arrived yet ("Still thinking…"). Static text, no motion. */
  hint?: string;
  /**
   * A failed or cut-off answer: the message, plus a Retry control when retrying can help (the
   * caption takes pointer events then).
   */
  error?: { message: string; onRetry?(): void };
};

/** The cross-fade between reading windows (ui.css .caption-text / .caption-leaving). */
const SWAP_MS = 180;
/** Text width the measure may be off by (canvas vs layout rounding, letter-spacing). */
const SLACK = 2;

/** Measures text in the caption's font, cached per string. */
function makeMeasure(el: HTMLElement): (s: string) => number {
  const cs = getComputedStyle(el);
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return (s) => s.length * (parseFloat(cs.fontSize) || 15) * 0.55;
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if ('letterSpacing' in ctx && cs.letterSpacing !== 'normal') (ctx as { letterSpacing: string }).letterSpacing = cs.letterSpacing;
  const cache = new Map<string, number>();
  return (s) => {
    let w = cache.get(s);
    if (w == null) { w = ctx.measureText(s).width; cache.set(s, w); }
    return w;
  };
}

export function Caption({ words, visible, question, waiting = false, hint, error }: Props) {
  const tokens = groupWords(words);
  const viewRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The window: where it starts, how many tokens it has seen, and for which width.
  const win = useRef({ start: 0, n: 0, width: 0 });
  const [start, setStart] = useState(0);
  const [leaving, setLeaving] = useState<{ key: number; text: string[] } | null>(null);
  /** Two lines tall from the first time the answer needs them, so the dock doesn't breathe. */
  const [tall, setTall] = useState(false);
  const measureRef = useRef<((s: string) => number) | null>(null);

  const hasText = tokens.length > 0 && !error;
  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const apply = () => { measureRef.current = makeMeasure(el); setWidth(el.clientWidth); };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasText]);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    const w = win.current;
    if (!tokens.length) {
      w.start = 0; w.n = 0;
      setStart(0); setTall(false); setLeaving(null);
      return;
    }
    if (!measure || width <= 0) return;
    const avail = width - SLACK;
    let fresh = false;
    if (w.width !== avail || tokens.length < w.n) { w.start = 0; w.n = 0; w.width = avail; fresh = true; }
    const before = w.start;
    for (let i = w.n; i < tokens.length; i++) w.start = windowStart(tokens, w.start, i, avail, measure);
    const shownBefore = tokens.slice(before, w.n);
    w.n = tokens.length;
    if (w.start !== before && !fresh && shownBefore.length) setLeaving({ key: before, text: shownBefore });
    setStart(w.start);
    if (countLines(tokens.slice(w.start), avail, measure) >= 2) setTall(true);
  }, [tokens.length, tokens[tokens.length - 1], width]);

  useLayoutEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), SWAP_MS + 40);
    return () => window.clearTimeout(t);
  }, [leaving]);

  const shown = visible && (tokens.length > 0 || !!question || !!error);
  const showHint = !!hint && !error && tokens.length === 0;
  const visibleTokens = tokens.slice(Math.min(start, tokens.length));
  return (
    <div className={`caption${shown ? ' is-visible' : ''}${error?.onRetry ? ' has-error' : ''}`} aria-hidden={!shown}>
      {question && (
        <div className={`caption-q${waiting && !error ? ' is-waiting' : ''}`} title={question}>{question}</div>
      )}
      {error ? (
        <div className="caption-error">
          <span className="caption-error-msg">{error.message}</span>
          {error.onRetry && (
            <button type="button" className="caption-retry" onClick={error.onRetry} tabIndex={shown ? 0 : -1}>Retry</button>
          )}
        </div>
      ) : showHint ? (
        <div className="caption-hint">{hint}</div>
      ) : tokens.length > 0 && (
        <div className={`caption-viewport${tall ? ' is-tall' : ''}`} ref={viewRef}>
          {leaving && (
            <div className="caption-text caption-leaving" key={`l${leaving.key}`} aria-hidden="true">
              {leaving.text.join(' ')}
            </div>
          )}
          <div className={`caption-text${start > 0 ? ' is-next' : ''}`} key={start}>
            {visibleTokens.map((t, i) => (
              <span key={i} className="caption-word">{t} </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
