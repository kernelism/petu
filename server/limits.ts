// server/limits.ts — output budgets shared by the server and the eval's budget preflight (no imports,
// so node scripts can read it directly).

/** The judge's max_output_tokens (server/openai.ts judge()). */
export const JUDGE_MAX_OUTPUT = 1600;
/** Stage 1 (scout): its JSON is the opener (one or two sentences), ≤ 6 pages and ≤ 80 words. */
export const SCOUT_MAX_OUTPUT = 600;
/**
 * The storyboard (lesson design, a reasoning model): its JSON is a handful of short fields and beats;
 * reasoning tokens count against this budget too.
 */
export const STORYBOARD_MAX_OUTPUT = 4000;
