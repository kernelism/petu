// src/ui/Transcript.tsx — the ask bar's transcript panel: the last answer after it ends, and (founder
// 2026-10-30, item 4) the answer as it plays: the sentence being spoken is lit, the panel follows it
// unless the student scrolled away, and a click on a sentence plays on from there.
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { joinWords } from './Caption';
import type { LiveTranscript } from './transcriptLive';
import './ui.css';

export type Transcript = { question: string; answer: string };

/** Pixels of slack: the current sentence counts as in view when it is this close to the panel's edge. */
const IN_VIEW_SLACK = 8;
/** A scroll this soon after the panel moved itself is the panel's own, not the student's. */
const OWN_SCROLL_MS = 400;

export function TranscriptPanel({ transcript, live, bottom }: {
  transcript?: Transcript | null;
  live?: LiveTranscript | null;
  /** The panel's gap above the bar (px; default the stylesheet's 10): clear of the caption while an answer plays. */
  bottom?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  /** Follow the spoken sentence (false once the student scrolls it out of view; back in view, true again). */
  const follow = useRef(true);
  const ownScroll = useRef(0);
  const current = live?.current ?? -1;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !live || !follow.current) return;
    const s = el.querySelector<HTMLElement>('.transcript-s.is-current');
    if (!s) { ownScroll.current = performance.now(); el.scrollTop = el.scrollHeight; return; }
    // Keep the spoken sentence in the lower part of the panel, with what led to it above.
    const top = s.offsetTop - el.clientHeight + s.offsetHeight + 24;
    if (Math.abs(el.scrollTop - Math.max(0, top)) > 1) { ownScroll.current = performance.now(); el.scrollTop = Math.max(0, top); }
  }, [current, live?.sentences.length, live]);

  const onScroll = () => {
    const el = ref.current;
    if (!el || !live || performance.now() - ownScroll.current < OWN_SCROLL_MS) return;
    const s = el.querySelector<HTMLElement>('.transcript-s.is-current');
    if (!s) { follow.current = el.scrollTop + el.clientHeight >= el.scrollHeight - IN_VIEW_SLACK; return; }
    const top = s.offsetTop - el.scrollTop, bottomEdge = top + s.offsetHeight;
    follow.current = top >= -IN_VIEW_SLACK && bottomEdge <= el.clientHeight + IN_VIEW_SLACK;
  };

  const seekKey = (e: KeyboardEvent<HTMLElement>, w: number) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); live?.onSeek(w); }
  };

  const question = live?.question ?? transcript?.question ?? '';
  return (
    <section
      ref={ref}
      className={`transcript${live ? ' is-live' : ''}`}
      aria-label="Transcript"
      onMouseDown={(e) => e.stopPropagation()}
      onScroll={onScroll}
      style={bottom != null ? { bottom: `calc(100% + ${bottom}px)` } : undefined}
    >
      <p className="transcript-q">{question}</p>
      {live ? (
        <p className="transcript-a">
          {live.sentences.map((s, i) => (
            <span key={s.start}>
              {i > 0 && ' '}
              <span
                className={`transcript-s${i === current ? ' is-current' : ''}`}
                role="button"
                tabIndex={0}
                aria-current={i === current ? 'true' : undefined}
                title="Play from here"
                onClick={() => live.onSeek(s.start)}
                onKeyDown={(e) => seekKey(e, s.start)}
              >
                {joinWords(s.words)}
              </span>
            </span>
          ))}
        </p>
      ) : (
        <p className="transcript-a">{transcript?.answer}</p>
      )}
    </section>
  );
}
