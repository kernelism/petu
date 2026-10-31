// src/agent/pacing.ts — an answer's length budget, from the scout's plan (founder 2026-10-29: length by
// the question's scope; a narrow question lands in 30–60 s, a broad one may take longer).
//
// The scout's plan ends with its numbered beats (the last is the check question) and "Scope: narrow|
// standard|broad". One pure reading of it is used end to end:
//  - the server tells stage 2 its beat count and words per beat (budgetNote, in the PLAN block);
//  - the live gate counts stage-2 words as they are released and, past the budget, closes the answer at
//    the next beat boundary with the check question (src/gate/live.ts).
// Words are spoken at ~2.4 a second (measured: six live Opus p6.0 answers, 140–259 words over 58–118 s,
// pauses included), so seconds and words convert with WORDS_PER_SEC.

export type Scope = 'narrow' | 'standard' | 'broad';

/** Spoken words per second, sentence pauses included (measured on recorded answers at the default 170 wpm). */
export const WORDS_PER_SEC = 2.4;
/**
 * Seconds per scope: `target` is what stage 2 is asked to fit (opener included), `cap` is where the
 * gate closes the answer. Narrow: the founder's 30–60 s.
 */
export const SCOPE_SECONDS: Record<Scope, { target: number; cap: number }> = {
  narrow: { target: 50, cap: 60 },
  standard: { target: 75, cap: 95 },
  broad: { target: 120, cap: 150 },
};
/** Beats a plan of that scope has when it lists none. */
const DEFAULT_BEATS: Record<Scope, number> = { narrow: 3, standard: 4, broad: 6 };
/** The check question's own words (it is always kept). */
export const CHECK_WORDS = 18;
/** A teaching beat never gets fewer words than this (a beat is a claim and what to notice in the drawing). */
const MIN_BEAT_WORDS = 22;

export type Budget = {
  scope: Scope;
  /** Whether the plan said its scope (else standard was assumed). */
  stated: boolean;
  /** Beats in the plan, the check question included. */
  beats: number;
  /** Spoken words per teaching beat stage 2 is asked for. */
  wordsPerBeat: number;
  /** Stage-2 words asked for (the opener's words taken off the scope's target). */
  words: number;
  /** Stage-2 words past which the gate closes the answer at the next beat boundary. */
  capWords: number;
  /** The scope's target seconds (opener included). */
  seconds: number;
};

const wordsOf = (s: string) => s.replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The plan's scope ("Scope: narrow"), or null. */
export function scopeOf(plan: string): Scope | null {
  const m = /\bscope\s*[:=-]?\s*(narrow|standard|broad)\b/i.exec(plan);
  return m ? (m[1].toLowerCase() as Scope) : null;
}

/**
 * The plan's numbered beats ("1. … 2. …" or "Beats: 1 … 2 …", a trailing "check: …" counted as one),
 * in order. Numbers must run 1, 2, 3 …: numbers inside a beat ("9.8 m/s", "2 kg") are not beats.
 */
export function planBeats(plan: string): string[] {
  const p = plan.replace(/\bscope\s*[:=-]?\s*(narrow|standard|broad)\b\.?/i, ' ');
  const re = /(?:^|[\s;:(])(\d{1,2})([.)]?)\s+(?=[\p{L}"'‘“(])/gu;
  const ms = [...p.matchAll(re)].map((m) => ({ n: Number(m[1]), dot: !!m[2], at: m.index!, body: m.index! + m[0].length }));
  // Every run 1, 2, 3 … the plan holds; the best has the most beats, then the most "1." numbers, then comes last.
  let best: typeof ms = [];
  let bestScore = -1;
  ms.forEach((m, i) => {
    if (m.n !== 1) return;
    const run = [m];
    for (const x of ms.slice(i + 1)) if (x.n === run.length + 1) run.push(x);
    const score = run.length + run.filter((x) => x.dot).length / 2;
    if (score >= bestScore) { best = run; bestScore = score; }
  });
  const out = best.map((b, i) => p.slice(b.body, i + 1 < best.length ? best[i + 1].at : p.length).replace(/[\s;,.…]+$/, '').trim());
  // "…; check: a faster current" after the numbered beats is the check beat.
  if (out.length) {
    const last = out[out.length - 1];
    const ck = /[;.]\s*(check(?: question)?\s*:.*)$/i.exec(last);
    if (ck && ck.index > 0) { out[out.length - 1] = last.slice(0, ck.index).trim(); out.push(ck[1].trim()); }
  }
  return out.filter(Boolean);
}

/** The budget an answer gets from its plan and the opener already spoken; null without a plan. */
export function budgetOf(plan: string | undefined, opener = ''): Budget | null {
  if (!plan?.trim()) return null;
  const said = scopeOf(plan);
  const scope = said ?? 'standard';
  const listed = planBeats(plan).length;
  // A plan with neither (a fallback, an older scout) gives no budget: nothing to measure the answer by.
  if (!said && listed < 2) return null;
  const beats = listed >= 2 ? listed : DEFAULT_BEATS[scope];
  const sec = SCOPE_SECONDS[scope];
  const ow = wordsOf(opener);
  const teach = Math.max(1, beats - 1);
  // A plan longer than its scope keeps its beats whole: the per-beat words shrink to a floor, never the plan.
  const words = Math.max(Math.round(sec.target * WORDS_PER_SEC) - ow, CHECK_WORDS + teach * MIN_BEAT_WORDS);
  const capWords = Math.max(Math.round(sec.cap * WORDS_PER_SEC) - ow, words + 12);
  const wordsPerBeat = Math.max(MIN_BEAT_WORDS, Math.round((words - CHECK_WORDS) / teach / 5) * 5);
  return { scope, stated: !!said, beats, wordsPerBeat, words, capWords, seconds: sec.target };
}

/**
 * The line stage 2 reads after the PLAN: its beat count and words per beat. `check`: 'hidden' (the svg
 * prompt, p6.2: the narration ends on the takeaway; a check question, if any, is written hidden, never
 * spoken) or 'spoken' (the tag prompt: the answer ends on its check question).
 */
export function budgetNote(b: Budget | null, check: 'hidden' | 'spoken' = 'hidden'): string {
  if (!b) return '';
  const teach = Math.max(1, b.beats - 1);
  if (check === 'hidden') return `BUDGET (${b.scope} question): after the opening, ${teach} teaching beat${teach === 1 ? '' : 's'} of about ${b.wordsPerBeat} spoken words each, ending on the takeaway: about ${b.words} words, ${Math.round(b.seconds)} seconds with the opening. Fit the whole plan into it; when the takeaway has landed, stop.`;
  return `BUDGET (${b.scope} question): after the opening, ${teach} teaching beat${teach === 1 ? '' : 's'} of about ${b.wordsPerBeat} spoken words each, then the check question: about ${b.words} words, ${Math.round(b.seconds)} seconds with the opening. Fit the whole plan into it; when the check question has been asked, stop.`;
}
