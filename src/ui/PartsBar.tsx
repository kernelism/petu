// src/ui/PartsBar.tsx
import { useState } from 'react';
import { CornerDownRight, Pause, Play, RotateCcw } from 'lucide-react';
import './ui.css';

/**
 * The playing answer's controls, one slim row at the top of the caption (in place of the question
 * line): pause/resume, where the answer is (the current part's title, or the question when it has
 * one part), a rail of part segments (≥ 2 parts: done / current with its progress / upcoming; click
 * or ←/→ to move between them), replay the sentence (R), speed (< >) and Go deeper.
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
  onDeeper(): void;
};

/** "1×", "1.25×", "0.75×". */
export const speedLabel = (s: number) => `${s}×`;

export function PartsBar({ titles, label, current, progress, paused, speed, onJump, onTogglePause, onReplay, onSpeed, onDeeper }: PartsView) {
  /** A segment under the pointer or focus: the title slot previews that part. */
  const [preview, setPreview] = useState<number | null>(null);
  const multi = titles.length > 1;
  const shown = multi && preview != null && preview < titles.length ? preview : current;
  const title = multi ? titles[shown] ?? '' : label ?? (paused ? 'Paused' : '');
  return (
    <div className="pb" role="toolbar" aria-label="Answer playback">
      <button type="button" className="pb-btn pb-play" onClick={onTogglePause} aria-label={paused ? 'Resume (Space)' : 'Pause (Space)'} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
        {paused ? <Play size={13} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={13} strokeWidth={2.2} aria-hidden="true" />}
      </button>
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
      <button type="button" className="pb-btn" onClick={onReplay} aria-label="Replay this sentence (R)" title="Replay this sentence (R)">
        <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button type="button" className="pb-btn pb-speed" onClick={onSpeed} aria-label={`Speed ${speedLabel(speed)}; change speed (< >)`} title="Speed (< slower, > faster)">
        {speedLabel(speed)}
      </button>
      <button type="button" className="pb-btn" onClick={onDeeper} aria-label="Go deeper on this part (the answer waits)" title="Go deeper on this part (the answer waits)">
        <CornerDownRight size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
