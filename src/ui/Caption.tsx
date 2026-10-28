import { useLayoutEffect, useRef, useState } from 'react';
import { primes } from './text';
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
  /** Between Enter and the first word: the echoed question shimmers. */
  waiting?: boolean;
  /** A failed answer: the message plus a Retry control (the caption takes pointer events then). */
  error?: { message: string; onRetry(): void };
};

export function Caption({ words, visible, question, waiting = false, error }: Props) {
  const tokens = groupWords(words);
  const textRef = useRef<HTMLDivElement>(null);
  const lastH = useRef(0);
  const [overflow, setOverflow] = useState(false);

  // When a new line is added the text block grows upward; slide it up instead of jumping (FLIP).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) { lastH.current = 0; return; }
    const line = parseFloat(getComputedStyle(el).lineHeight) || 15 * 1.45;
    const h = el.offsetHeight;
    const dh = h - lastH.current;
    lastH.current = h;
    setOverflow(h > line * 2 + 2);
    if (dh > line / 2 && h > line * 1.5) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dh}px)`;
      void el.offsetHeight;
      el.style.transition = '';
      el.style.transform = '';
    }
  }, [tokens.length, tokens[tokens.length - 1]]);

  const shown = visible && (tokens.length > 0 || !!question || !!error);
  return (
    <div className={`caption${shown ? ' is-visible' : ''}${error ? ' has-error' : ''}`} aria-hidden={!shown}>
      {question && (
        <div className={`caption-q${waiting && !error ? ' is-waiting' : ''}`} title={question}>{question}</div>
      )}
      {error ? (
        <div className="caption-error">
          <span>{error.message}</span>
          <button type="button" className="caption-retry" onClick={error.onRetry} tabIndex={shown ? 0 : -1}>Retry</button>
        </div>
      ) : tokens.length > 0 && (
        <div className={`caption-viewport${overflow ? ' has-overflow' : ''}`}>
          <div className="caption-text" ref={textRef}>
            {tokens.map((t, i) => (
              <span key={i} className="caption-word">{t} </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
