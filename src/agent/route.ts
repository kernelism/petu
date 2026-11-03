// src/agent/route.ts — where a question goes when the student asks it while an answer plays.
//
// Two intents look the same in the bar: a side question ("wait, what is a prior?") that should be
// answered briefly before the answer goes on, and a change of mind ("skip that, what does the graph on
// the last page show") that should replace the answer. Every question asked mid-answer used to become an
// aside by construction; nothing here reads the student's words. The scout reads them, with the paused
// answer, and writes the route first (src/agent/scout.ts `route`), so the app learns where the answer
// plays before its first word and the question is never sent twice:
//   aside  the answer waits paused; the side answer plays in its inset; "Back to answer" resumes it.
//   new    the answer ends where it is (its drawing in progress is withdrawn: Director.stop('withdraw'))
//          and this question is answered in its place, told what the student heard (moment `replaced`).
// Without a route (a dev script, a replay, a scout that failed or gave none) it is an aside: the
// answer is only paused, and the aside strip's "Answer instead" still replaces it.
import type { Route } from './scout';

/** What the bar's Enter does: a new answer, ask the scout where it goes, or an aside straight away (no scout to ask). */
export type AskTarget = 'answer' | 'route' | 'aside';

/** `playing`: an answer (or an aside over it) is in progress; `agent`: that answer came from the agent (it has a scout). */
export function askTarget(s: { playing: boolean; agent: boolean }): AskTarget {
  if (!s.playing) return 'answer';
  return s.agent ? 'route' : 'aside';
}

/** The route a question asked mid-answer takes: the scout's, else aside (the answer is kept, only paused). */
export const routeOf = (scouted: Route | null | undefined): Route => scouted ?? 'aside';
