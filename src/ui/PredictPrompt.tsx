// src/ui/PredictPrompt.tsx — the prediction prompt (src/playback/predict.ts): the answer is paused before a
// window's third position; the student types what it will output (or skips), sees whether it was right, and
// the step plays.
import { useEffect, useRef, useState } from 'react';
import { guessRight, type Prediction } from '../playback/predict';

/** How long the verdict shows before the step plays. */
export const VERDICT_MS = 1800;

export function PredictPrompt({ p, onDone }: { p: Prediction; onDone: () => void }) {
  const [guess, setGuess] = useState('');
  const [verdict, setVerdict] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (verdict == null) return;
    const t = window.setTimeout(onDone, VERDICT_MS);
    return () => window.clearTimeout(t);
  }, [verdict, onDone]);
  const check = () => {
    const ok = guessRight(guess, p);
    if (ok == null) return;
    setVerdict(ok ? `Right: ${p.text}.` : `Not quite: it is ${p.text}. Watch where it comes from.`);
  };
  return (
    <div className="predict-card" role="dialog" aria-label="Predict the next step" onKeyDown={(e) => e.stopPropagation()}>
      <p className="predict-q">Your turn: where does the window go next, and what will it output?</p>
      {verdict == null ? (
        <form className="predict-row" onSubmit={(e) => { e.preventDefault(); check(); }}>
          <input ref={input} className="predict-input" inputMode="decimal" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="the output" aria-label="the output" />
          <button type="submit" className="predict-btn" disabled={!guess.trim()}>Check</button>
          <button type="button" className="btn-quiet predict-skip" onClick={onDone}>Skip</button>
        </form>
      ) : (
        <p className="predict-verdict" aria-live="polite">{verdict}</p>
      )}
    </div>
  );
}
