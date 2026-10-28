import { useLayoutEffect, useRef, useState } from 'react';
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
  return out;
}

/** Joins caption words with spaces, gluing punctuation-only tokens ("x" + "." → "x."). */
export const joinWords = (words: string[]): string => groupWords(words).join(' ');

const LINE_PX = 15 * 1.45;

export function Caption({ words, visible }: { words: string[]; visible: boolean }) {
  const tokens = groupWords(words);
  const textRef = useRef<HTMLDivElement>(null);
  const lastH = useRef(0);
  const [overflow, setOverflow] = useState(false);

  // When a new line is added the text block grows upward; slide it up instead of jumping (FLIP).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const dh = h - lastH.current;
    lastH.current = h;
    setOverflow(h > LINE_PX * 2 + 2);
    if (dh > LINE_PX / 2 && h > LINE_PX * 1.5) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dh}px)`;
      void el.offsetHeight;
      el.style.transition = '';
      el.style.transform = '';
    }
  }, [tokens.length, tokens[tokens.length - 1]]);

  return (
    <div className={`caption${visible && tokens.length ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <div className={`caption-viewport${overflow ? ' has-overflow' : ''}`}>
        <div className="caption-text" ref={textRef}>
          {tokens.map((t, i) => (
            <span key={i} className="caption-word">{t} </span>
          ))}
        </div>
      </div>
    </div>
  );
}
