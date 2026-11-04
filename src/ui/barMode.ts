// src/ui/barMode.ts
/**
 * One ask bar whose meaning follows the moment (spec "v1 learner UX"). Pure, so it is testable:
 *
 *   ask      nothing asked yet                       "Ask about this PDF…"   Enter asks
 *   during   an answer is playing (or paused)         "Ask about this…"       typing pauses it; Enter asks, and the scout
 *                                                                            routes it (src/agent/route.ts): an aside, or
 *                                                                            a new answer in the paused one's place
 *   aside    an aside is open over the paused answer  "Ask about this…"       Enter on an empty bar resumes
 *   follow   an answer has ended                      "Follow up…"            Enter asks a follow-up
 *   check    the answer ended on a check question     "Your answer…"          Enter sends the reply (judged on the board)
 */
export type BarMode = 'ask' | 'during' | 'aside' | 'follow' | 'check';

export type BarState = {
  /** An answer is in progress (loading, playing or paused). */
  busy: boolean;
  /** An aside is open (the main answer waits, paused). */
  aside: boolean;
  /** At least one answer has played this session. */
  answered: boolean;
  /** The last answer ended on a question to the student, not yet replied to. */
  check: string | null;
};

export function barMode(s: BarState): BarMode {
  if (s.aside) return 'aside';
  if (s.busy) return 'during';
  if (s.check) return 'check';
  return s.answered ? 'follow' : 'ask';
}

export const PLACEHOLDER: Record<BarMode, string> = {
  ask: 'Ask about this PDF…',
  during: 'Ask about this…',
  aside: 'Ask about this…',
  follow: 'Follow up…',
  check: 'Your answer…',
};

/** The accessible name of the field in each mode. */
export const BAR_LABEL: Record<BarMode, string> = {
  ask: 'Ask about this PDF',
  during: 'Ask about this (the answer pauses)',
  aside: 'Ask about this (the answer is paused)',
  follow: 'Follow up',
  check: 'Your answer to the check question',
};

