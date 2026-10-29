// scripts/gallery/scenes.ts — what the gallery renders. Moments are fake-clock ms after a named
// checkpoint: `start` (the answer began: the ask bar's stop button appears) or `done` (it went away).
// The page's clock is Playwright's fake clock, advanced in fixed steps, so a moment is the same frame
// on every run.
export type Moment = { name: string; after: 'start' | 'done'; ms: number };
export type Scene = { name: string; query: string; moments: Moment[]; /** A local file the scene needs (skipped when absent). */ needs?: string };

const mid = (ms: number): Moment => ({ name: `${Math.round(ms / 1000)}s`, after: 'start', ms });
const END: Moment = { name: 'end', after: 'done', ms: 3000 };

export const SCENES: Scene[] = [
  { name: 'demo1', query: 'demo=1', moments: [mid(4000), mid(12000), END] },
  { name: 'side', query: 'demo=side', moments: [mid(6000), mid(14000), END] },
  { name: 'plane', query: 'demo=plane', moments: [mid(6000), END] },
  { name: 'kit', query: 'script=kit', moments: [mid(10000), mid(30000), END] },
  { name: 'toolkit', query: 'script=toolkit', moments: [mid(10000), END] },
  { name: 'relational', query: 'script=relational', moments: [mid(8000), END] },
  { name: 'scene', query: 'script=scene', moments: [mid(20000), END] },
  { name: 'scene-econ', query: 'script=scene-econ', moments: [mid(20000), END] },
  { name: 'scene-bio', query: 'script=scene-bio', moments: [mid(20000), END] },
  { name: 'lec09', query: 'script=lec09', moments: [mid(14000), END], needs: 'public/dev/lec09_optical_flow.pdf' },
];

export const SIZES = ['1440x900', '2560x1440'] as const;
export const BROWSERS = ['chromium', 'webkit'] as const;
