// src/ui/PartsBar.tsx
import { Pause, Play, CornerDownRight } from 'lucide-react';
import './ui.css';

/**
 * The answer's parts as a compact stepper in the caption ("1 The Law of Demand · 2 Back to p9"),
 * with pause/resume (Space) and "Go deeper" on the current part. ←/→ step between parts.
 */
export type PartsView = {
  titles: string[];
  current: number;
  paused: boolean;
  onJump(i: number): void;
  onTogglePause(): void;
  onDeeper(): void;
};

export function PartsBar({ titles, current, paused, onJump, onTogglePause, onDeeper }: PartsView) {
  return (
    <div className="parts">
      <button type="button" className="parts-btn parts-play" onClick={onTogglePause} aria-label={paused ? 'Resume (Space)' : 'Pause (Space)'} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
        {paused ? <Play size={13} strokeWidth={2.2} aria-hidden="true" /> : <Pause size={13} strokeWidth={2.2} aria-hidden="true" />}
      </button>
      {titles.length > 1 ? (
        <ol className="parts-list" aria-label="Parts of this answer">
          {titles.map((t, i) => (
            <li key={i} className={`parts-item${i === current ? ' is-current' : ''}${i < current ? ' is-done' : ''}`}>
              <button type="button" className="parts-step" onClick={() => onJump(i)} aria-current={i === current ? 'step' : undefined} title={`${t} (${i < current ? '←' : '→'})`}>
                <span className="parts-n">{i + 1}</span>
                <span className="parts-title">{t}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <span className="parts-status">{paused ? 'Paused · Space to continue' : ''}</span>
      )}
      <button type="button" className="parts-btn parts-deeper" onClick={onDeeper} title="Go deeper on this part (the answer waits)">
        <CornerDownRight size={13} strokeWidth={2.2} aria-hidden="true" />
        Go deeper
      </button>
    </div>
  );
}
