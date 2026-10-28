// src/agent/storyboard.ts — the lesson design between the scout and the performer (spec "Board v2" 5),
// shared by the dev server (which asks for it) and the browser (which shows it in ?debug).
//
// After the scout's pages and plan are known, a reasoning model reads the same grounding stage 2
// gets (digest, the chosen pages' listings and images, the opener already spoken, the question) and
// designs the lesson as strict JSON: the student's likely confusion, one carrying example, the
// central scene, the beats, the aha and a check question. Stage 2 then performs it (it still writes
// every tag). Anything unusable here — a timeout, bad JSON, a missing field — means stage 2 runs on
// the scout's plan alone, as before.

export type Beat = {
  /** What this beat says, as intent (not the words). */
  say: string;
  /** How the board changes (intent, never tags). */
  board: string;
  /** Where the slides point: a page and the thing on it, or empty. */
  slide: string;
  /** How the board ties to the page in this beat (a connector, a shared label), or empty. */
  ties: string;
};

export type Storyboard = {
  confusion: string;
  /** The carrying example: concrete, with its values. */
  example: string;
  scene: { things: string; relations: string; changes: string };
  beats: Beat[];
  /** 1-based number of the beat where it clicks. */
  aha: number;
  check: string;
};

/** The structured-output schema (strict: every field required, nothing else). */
export const STORYBOARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confusion', 'example', 'scene', 'beats', 'aha', 'check'],
  properties: {
    confusion: { type: 'string', description: 'What this student most likely does not yet see, after the opener.' },
    example: { type: 'string', description: 'The one concrete case that carries the whole lesson, with its values.' },
    scene: {
      type: 'object', additionalProperties: false, required: ['things', 'relations', 'changes'],
      properties: {
        things: { type: 'string', description: 'What sits on the board.' },
        relations: { type: 'string', description: 'How those things are connected to each other and to the page.' },
        changes: { type: 'string', description: 'What will change in the scene as the lesson goes on.' },
      },
    },
    beats: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['say', 'board', 'slide', 'ties'],
        properties: {
          say: { type: 'string', description: 'What the tutor says in this beat (intent, not a script).' },
          board: { type: 'string', description: 'How the scene changes (intent, not tags); empty if it does not.' },
          slide: { type: 'string', description: 'Page and thing to point at, e.g. "p4: the second equation"; empty if none.' },
          ties: { type: 'string', description: 'Connections between the board and the page in this beat; empty if none.' },
        },
      },
    },
    aha: { type: 'integer', description: 'The number (from 1) of the beat where it clicks.' },
    check: { type: 'string', description: 'A short question the student can answer with the scene in front of them.' },
  },
} as const;

/** Sanity bounds for what is passed on to stage 2 (the model's JSON, not its prompt). */
export const STORYBOARD_LIMITS = { field: 800, beats: 12, json: 16_000 };

export type StoryboardParse = { board: Storyboard } | { fallback: string };

const str = (v: unknown, n = STORYBOARD_LIMITS.field): string => (typeof v === 'string' ? clip(v.replace(/\s+/g, ' ').trim(), n) : '');

/**
 * Parses and validates the storyboard model's output. Tolerates code fences and prose around the
 * object, over-long fields (cut), extra beats (cut) and an out-of-range aha (the middle beat). A
 * storyboard without an example or without a beat that says something is unusable.
 */
export function parseStoryboard(text: string): StoryboardParse {
  const s = text.trim();
  if (!s) return { fallback: 'storyboard was empty' };
  if (s.length > STORYBOARD_LIMITS.json * 2) return { fallback: 'storyboard too large' };
  let raw: unknown;
  try { raw = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { fallback: 'storyboard returned no JSON' };
    try { raw = JSON.parse(s.slice(a, b + 1)); } catch { return { fallback: 'storyboard returned bad JSON' }; }
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return { fallback: 'storyboard returned no object' };
  const o = raw as Record<string, unknown>;
  const sc = (o.scene != null && typeof o.scene === 'object' ? o.scene : {}) as Record<string, unknown>;
  const beats: Beat[] = [];
  for (const b of Array.isArray(o.beats) ? o.beats : []) {
    if (b == null || typeof b !== 'object') continue;
    const x = b as Record<string, unknown>;
    const beat = { say: str(x.say), board: str(x.board), slide: str(x.slide, 300), ties: str(x.ties, 400) };
    if (beat.say || beat.board) beats.push(beat);
    if (beats.length >= STORYBOARD_LIMITS.beats) break;
  }
  const example = str(o.example);
  if (!beats.length) return { fallback: 'storyboard has no beats' };
  if (!example) return { fallback: 'storyboard has no example' };
  const n = typeof o.aha === 'number' ? o.aha : typeof o.aha === 'string' ? Number(o.aha) : NaN;
  const aha = Number.isInteger(n) && n >= 1 && n <= beats.length ? n : Math.ceil(beats.length / 2);
  return {
    board: {
      confusion: str(o.confusion), example,
      scene: { things: str(sc.things), relations: str(sc.relations), changes: str(sc.changes) },
      beats, aha, check: str(o.check, 400),
    },
  };
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** The storyboard as stage 2 reads it (the volatile tail of its request). */
export function storyboardText(b: Storyboard): string {
  const lines = [
    'STORYBOARD (the lesson designed for this answer by a planner who read the same pages and heard the opening; perform it: follow its example, scene and beats in order, writing your own words and tags. Where it is wrong about a page, the page wins.)',
    `Likely confusion: ${b.confusion || '—'}`,
    `Carrying example: ${b.example}`,
    `Central scene: ${[b.scene.things && `things: ${b.scene.things}`, b.scene.relations && `relations: ${b.scene.relations}`, b.scene.changes && `what changes: ${b.scene.changes}`].filter(Boolean).join('; ') || '—'}`,
    'Beats:',
    ...b.beats.map((x, i) => `${i + 1}.${i + 1 === b.aha ? ' (the aha)' : ''} say: ${x.say || '—'} | board: ${x.board || 'no change'}${x.slide ? ` | slide: ${x.slide}` : ''}${x.ties ? ` | ties: ${x.ties}` : ''}`),
    ...(b.check ? [`Check question (end on it, asked of the student): ${b.check}`] : []),
  ];
  return lines.join('\n');
}
