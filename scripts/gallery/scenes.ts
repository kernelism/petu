// scripts/gallery/scenes.ts — what the gallery renders. Moments are fake-clock ms after a named
// checkpoint: `start` (the answer began: the ask bar's stop button appears) or `done` (it went away).
// The page's clock is Playwright's fake clock, advanced in fixed steps, so a moment is the same frame
// on every run.
/** `keys`: pressed (Playwright key names) when the moment is reached, before the shot (playback controls). */
export type Moment = { name: string; after: 'start' | 'done'; ms: number; keys?: string[] };
export type Scene = { name: string; query: string; moments: Moment[]; /** A local file the scene needs (skipped when absent). */ needs?: string;
  /**
   * Audit the live gate (design 2026-10-29 §8): dev scripts play under `&gate=audit` (the app's default
   * for them), and any gate flag, drop or shadow drift the app publishes (window.__petuGateLog) fails the
   * gallery. Default: on for `script=` scenes; the gate demo itself fails beat 3 on purpose.
   */
  audit?: boolean };
/** Is the scene's gate log audited? */
export const audited = (s: Scene): boolean => s.audit ?? s.query.startsWith('script=');

const mid = (ms: number): Moment => ({ name: `${Math.round(ms / 1000)}s`, after: 'start', ms });
const END: Moment = { name: 'end', after: 'done', ms: 3000 };

export const SCENES: Scene[] = [
  { name: 'demo1', query: 'demo=1', moments: [mid(4000), mid(12000), END] },
  { name: 'side', query: 'demo=side', moments: [mid(6000), mid(14000), END] },
  { name: 'plane', query: 'demo=plane', moments: [mid(6000), END] },
  // The tail: amounts as parts (split, stacked bars), coins as tokens, histograms on shared bins.
  { name: 'kit', query: 'script=kit', moments: [mid(10000), mid(30000), mid(168000), mid(186000), END] },
  { name: 'toolkit', query: 'script=toolkit', moments: [mid(10000), END] },
  { name: 'relational', query: 'script=relational', moments: [mid(8000), END] },
  // Flow across the document: a unit highlight on p9, the journey to p2 (route chip, parts), the return.
  { name: 'flow', query: 'script=flow', moments: [mid(3000), mid(9000), mid(15000), mid(24000), END] },
  // The playback row: speed stepped up (>) and paused (Space) in the journey's part (rail, title, 1.25×).
  { name: 'flow-controls', query: 'script=flow', moments: [{ name: 'paused', after: 'start', ms: 15000, keys: ['>', 'Space'] }] },
  { name: 'scene', query: 'script=scene', moments: [mid(20000), END] },
  { name: 'scene-econ', query: 'script=scene-econ', moments: [mid(20000), END] },
  { name: 'scene-bio', query: 'script=scene-bio', moments: [mid(20000), END] },
  // A scene whose content is small: composed into the board at the end, id labels shown with spaces.
  { name: 'scene-small', query: 'script=scene-small', moments: [END] },
  // Demonstration moves and bound numbers: beforeafter (market), contrast (colony), limit (drag).
  { name: 'moves', query: 'script=moves', moments: [mid(12000), mid(26000), END] },
  // Live geometry: figures that move as a {{tween}} changes their constants (end + two moments mid-motion).
  { name: 'moving-tunnel', query: 'script=moving-tunnel', moments: [mid(24000), mid(28000), mid(32000), mid(36000), END] },
  { name: 'moving-skater', query: 'script=moving-skater', moments: [mid(20000), mid(23000), mid(26000), mid(29000), END] },
  { name: 'moving-market', query: 'script=moving-market', moments: [mid(16000), mid(19000), mid(22000), END] },
  { name: 'moving-pendulum', query: 'script=moving-pendulum', moments: [mid(10000), mid(12000), mid(14000), END] },
  // The slide as canvas: on the chart (data units), the enzyme lifted and acted out, notes in place.
  { name: 'canvas', query: 'script=canvas', moments: [mid(16000), mid(23500), mid(42000), mid(62000), END] },
  // The live gate: beat 3 names a point nothing carries. Live: it is dropped (no words, no ink). With an
  // injected skip and the fake repair (1.5 s), the demo's replacement plays in its place.
  { name: 'gate', query: 'script=gate&gate=live', moments: [END], audit: false },
  { name: 'gate-repair', query: 'script=gate&gate=live&gatefail=2:skip&repair=fake&repairms=1500', moments: [END], audit: false },
  // The prompt's few-shot examples on their own slides (public/fixtures/examples.pdf): what the model is shown, as a student sees it.
  // The svg board (p6, the default answer format): the prompt's two examples and the svgboard
  // experiment's four recorded answers, streamed as beats through the server's own filter.
  { name: 'svg-ferry', query: 'script=svg-ferry', moments: [mid(14000), mid(30000), END] },
  // A cut-off inside the first group (live gate): its whole children (the banks) draw, no SVG is spoken,
  // the caption offers Retry, the slides stay, the board stays closable.
  { name: 'cutoff', query: 'script=svg-ferry&gate=live&repair=fake&failat=500', moments: [END], audit: false },
  { name: 'svg-dough', query: 'script=svg-dough', moments: [mid(14000), mid(30000), END] },
  { name: 'svg-skater', query: 'script=svg-skater', moments: [mid(12000), END] },
  { name: 'svg-tunnel', query: 'script=svg-tunnel', moments: [mid(12000), END] },
  { name: 'svg-rent', query: 'script=svg-rent', moments: [mid(12000), END] },
  { name: 'svg-sinx', query: 'script=svg-sinx', moments: [mid(12000), END] },
  { name: 'ex-village', query: 'script=ex-village', moments: [mid(14000), mid(30000), END] },
  { name: 'ex-lighthouse', query: 'script=ex-lighthouse', moments: [mid(16000), mid(24000), END] },
  { name: 'ex-counter', query: 'script=ex-counter', moments: [mid(22000), END] },
  // v1 learner UX (storyboard frames 1–7), one simulated session on econ.pdf p12 (src/demo/learner.ts).
  { name: 'learner', query: 'script=learner', moments: [
    { name: '1-ask', after: 'start', ms: 12000 }, { name: '2-aside', after: 'start', ms: 24000 }, { name: '3-resume', after: 'start', ms: 36000 },
    { name: '4-follow', after: 'start', ms: 66000 }, { name: '5-point', after: 'start', ms: 78000 }, { name: '6-check', after: 'start', ms: 112000 },
    { name: '6-judged', after: 'start', ms: 134000 }, { name: '7-trail', after: 'start', ms: 160000 },
  ] },
  // A founder live test (chord tunnel): a fit sketch with a circle, a chord on it, labelled arrows.
  { name: 'tunnel', query: 'script=tunnel&style=hand', moments: [mid(26000), END], needs: '.petu/corpus/openstax-university-physics-volume-1.pdf' },
  // Founder live tests (layout2): bars side by side on one baseline/scale; labels at one point never stack; a zoom inset.
  { name: 'live-econ', query: 'script=live-econ', moments: [mid(30000), END], needs: '.petu/corpus/openstax-principles-economics-3e.pdf' },
  { name: 'live-calc', query: 'script=live-calc', moments: [mid(40000), END], needs: '.petu/corpus/openstax-calculus-volume-1.pdf' },
  { name: 'live-calc-zoom', query: 'script=live-calc-zoom', moments: [mid(40000), END], needs: '.petu/corpus/openstax-calculus-volume-1.pdf' },
  { name: 'lec09', query: 'script=lec09', moments: [mid(14000), END], needs: 'public/dev/lec09_optical_flow.pdf' },
];

export const SIZES = ['1440x900', '2560x1440'] as const;
export const BROWSERS = ['chromium', 'webkit', 'firefox'] as const;
/** Default browsers left out, with a note, when their Playwright build isn't installed (the gate keeps working without them). */
export const OPTIONAL_BROWSERS: readonly string[] = ['firefox'];

/**
 * The browsers a run renders. Asked-for browsers are kept as they are (a missing one fails at launch, loudly);
 * by default every BROWSERS entry, minus the optional ones not installed, each with a skip note.
 */
export function pickBrowsers(asked: string[] | undefined, installed: (b: string) => boolean): { browsers: string[]; skipped: string[] } {
  if (asked?.length) {
    const unknown = asked.filter((b) => !(BROWSERS as readonly string[]).includes(b));
    if (unknown.length) throw new Error(`unknown browser ${unknown.join(', ')} (known: ${BROWSERS.join(', ')})`);
    return { browsers: asked, skipped: [] };
  }
  const skipped: string[] = [];
  const browsers = BROWSERS.filter((b) => {
    if (!OPTIONAL_BROWSERS.includes(b) || installed(b)) return true;
    skipped.push(`${b} (not installed: \`npx playwright-core install ${b}\` once, or set PLAYWRIGHT_DIR)`);
    return false;
  });
  return { browsers, skipped };
}
