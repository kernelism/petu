// src/playback/predict.ts — one prediction prompt per answer (teaching-engine proposal §3.4, Phase 2's optional
// item): after an engine window has worked two positions, before its third, the answer pauses and asks the
// student what the window will output there. The value is the engine's own (what the window registered, the
// number the step then shows), never the model's. Optional (the `predict` setting), at most once an answer.
import type { RawAction } from '../script/types';
import { fmt } from '../desk/kit/compute';
import { readWeight } from '../svgboard/whatIf';

/** The window position the prompt asks about (1-based): the third, after two worked ones. */
export const PREDICT_AT = 3;

export type Prediction = { win: string; value: number; text: string };

type Scope = { consts: Record<string, number>; calcs?: { get(id: string): { out?: unknown } | undefined } };

/**
 * The prediction a tween calls for, or null: it moves an engine window's step constant on from PREDICT_AT − 1
 * (two worked positions) to PREDICT_AT or past it (a sweep: the third output is still the next one the
 * student sees appear). `windows`: the engine windows on the board (data-slide elements).
 */
export function predictionFor(a: RawAction, windows: Element[], sc: Scope): Prediction | null {
  if (a.kind !== 'tween') return null;
  for (const [name, expr] of a.sets) {
    const to = Number(expr.trim());
    const c = name.toLowerCase();
    if (!(to >= PREDICT_AT) || Math.round(sc.consts[c] ?? NaN) !== PREDICT_AT - 1) continue;
    for (const w of windows) {
      if ((w.getAttribute('data-step') ?? 'k').toLowerCase() !== c) continue;
      const id = (w.getAttribute('data-name') ?? w.getAttribute('id') ?? '').toLowerCase();
      const out = sc.calcs?.get(id)?.out;
      const flat = Array.isArray(out) ? (out as (number | number[])[]).flat() : [];
      const v = flat[PREDICT_AT - 1];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const dpA = w.getAttribute('data-fmt');
      return { win: id, value: v, text: fmt(v, dpA != null && /^\d+$/.test(dpA) ? Number(dpA) : undefined) };
    }
  }
  return null;
}

/** Whether the student's guess is the value: as the board writes it (its rounding), or within a hair. */
export function guessRight(guess: string, p: Prediction): boolean | null {
  const g = readWeight(guess);
  if (g == null) return null;
  return Math.abs(g - p.value) <= Math.max(1e-9, Math.abs(p.value) * 1e-6) || fmt(g) === p.text || String(g) === p.text;
}
