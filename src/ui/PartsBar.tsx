// src/ui/PartsBar.tsx
import { useState } from 'react';
import { CornerDownLeft, Pause, Play, RotateCcw, Square } from 'lucide-react';
import './ui.css';

/**
 * The playing answer's controls, one slim row at the top of the caption (in place of the question
 * line): pause/resume, where the answer is (the current part's title, or the question when it has
 * one part), a rail of part segments (≥ 2 parts: done / current with its progress / upcoming; click
 * or ←/→ to move between them), replay the sentence (R), speed (< >) and stop (Esc).
 * During an aside the row belongs to it, a quiet strip: "Side question" and "Back to answer" (Return),
 * the one obvious action. Its pause, replay and speed show only while the dock is hovered or focus is
 * in the row (ui.css, no JS: Tab still reaches them); no stop, Esc and Return close the aside.
 */
export type PartsView = {
  /** Part titles. Two or more show the rail; with one, `label` fills the title slot. */
  titles: string[];
  /** The title slot of a one-part answer (the question asked). */
  label?: string;
  current: number;
  /** How far through the current part the narration is, 0–1. */
  progress: number;
  paused: boolean;
  /** Playback speed (1 = the narration's wpm). */
  speed: number;
  onJump(i: number): void;
  onTogglePause(): void;
  onReplay(): void;
  /** Steps to the next speed (wrapping round). */
  onSpeed(): void;
  onStop(): void;
  /** An aside is open over the paused answer: the way back to it. */
  aside?: { onResume(): void };
};

/** "1×", "1.25×", "0.75×". */
export const speedLabel = (s: number) => `${s}×`;

export function PartsBar({ titles, label, current, progress, paused, speed, onJump, onTogglePause, onReplay, onSpeed, onStop, aside }: PartsView) {
  /** A segment under the pointer or focus: the title slot previews that part. */
  const [preview, setPreview] = useState<number | null>(null);
  const multi = titles.length > 1;
  const shown = multi && preview != null && preview < titles.length ? preview : current;
  const title = multi ? titles[shown] ?? '' : paused ? 'Paused' : label ?? '';
  /** The aside's buttons are in the Tab order in Safari too (it tabs only to explicit tabindex by default). */
  const tab = aside ? 0 : undefined;
  const play = (
    <button type="button" className="pb-btn pb-play" tabIndex={tab} onClick={onTogglePause} aria-label={paused ? 'Resume (Space)' : 'Pause (Space)'} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
      {paused ? <Play size={13} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={13} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
  const replay = (
    <button type="button" className="pb-btn" tabIndex={tab} onClick={onReplay} aria-label="Replay this sentence (R)" title="Replay this sentence (R)">
      <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
  const speedBtn = (
    <button type="button" className="pb-btn pb-speed" tabIndex={tab} onClick={onSpeed} aria-label={`Speed ${speedLabel(speed)}; change speed (< >)`} title="Speed (< slower, > faster)">
      {speedLabel(speed)}
    </button>
  );
  if (aside) {
    return (
      <div className={`pb is-aside${paused ? ' is-paused' : ''}`} role="toolbar" aria-label="Side question playback">
        <span className="pb-side">Side question</span>
        <span className="pb-more">{play}{replay}{speedBtn}</span>
        <button type="button" className="pb-resume" tabIndex={0} onClick={aside.onResume} title="Back to the answer (Return)">
          Back to answer <span className="pb-resume-k" aria-hidden="true"><CornerDownLeft size={12} strokeWidth={2} /></span>
        </button>
      </div>
    );
  }
  return (
    <div className={`pb${paused ? ' is-paused' : ''}`} role="toolbar" aria-label="Answer playback">
      {play}
      <div className={`pb-where${preview != null && preview !== current ? ' is-preview' : ''}`}>
        {multi && <span className="pb-count" aria-hidden="true">{shown + 1}/{titles.length}</span>}
        <span className="pb-title" title={title}>{title}</span>
      </div>
      {multi && (
        <ol className="pb-rail" aria-label="Parts of this answer" style={{ width: `${Math.min(titles.length * 30, 150)}px` }}>
          {titles.map((t, i) => {
            const state = i < current ? 'is-done' : i === current ? 'is-current' : 'is-next';
            return (
              <li key={i} className="pb-part">
                <button
                  type="button"
                  className={`pb-seg ${state}`}
                  onClick={() => onJump(i)}
                  onMouseEnter={() => setPreview(i)}
                  onMouseLeave={() => setPreview(null)}
                  onFocus={() => setPreview(i)}
                  onBlur={() => setPreview(null)}
                  aria-current={i === current ? 'step' : undefined}
                  aria-label={`Part ${i + 1} of ${titles.length}: ${t}`}
                >
                  <span className="pb-track" aria-hidden="true">
                    <span className="pb-fill" style={{ transform: `scaleX(${i < current ? 1 : i === current ? Math.max(0, Math.min(1, progress)) : 0})` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {replay}
      {speedBtn}
      <button type="button" className="pb-btn pb-stop" onClick={onStop} aria-label="Stop the answer (Esc)" title="Stop (Esc)">
        <Square size={10} strokeWidth={0} fill="currentColor" aria-hidden="true" />
      </button>
    </div>
  );
}
