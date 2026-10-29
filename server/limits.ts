// server/limits.ts — output budgets shared by the server and the eval's budget preflight (no imports,
// so node scripts can read it directly).

/** The judge's max_output_tokens (server/openai.ts judge()). */
export const JUDGE_MAX_OUTPUT = 1600;
/** Stage 1 (scout): its JSON is the opener (one or two sentences), ≤ 6 pages and a plan of ≤ 100 words ending with its beats. */
export const SCOUT_MAX_OUTPUT = 600;
/**
 * The storyboard (lesson design, a reasoning model): its JSON is a handful of short fields and beats;
 * reasoning tokens count against this budget too.
 */
export const STORYBOARD_MAX_OUTPUT = 4000;
/**
 * A repair (live gate, design §6): one replacement beat (≤ ~55 words + tags). The ledger reserves
 * this much output per repair; the eval preflight counts it too.
 */
export const REPAIR_MAX_OUTPUT = 450;
/** A repair in the svg answer mode rewrites a beat with its SVG group (groups run 300–1000 tokens). */
export const SVG_REPAIR_MAX_OUTPUT = 1400;
/** Repairs one answer may ask for (the server refuses the next with 429). */
export const MAX_REPAIRS = 2;
