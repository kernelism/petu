// src/agent/scout.ts — stage 1 of an answer, shared by the browser and the dev server.
//
// The scout reads the deck digest (every page, trimmed), the page in view, the previous exchange and
// the question, and returns which pages the answer should teach from, in teaching order, and a short
// plan. Its JSON is parsed defensively: anything unusable falls back to the visible page alone, so a
// scout failure never stops an answer.

/** What the browser sends to POST /api/scout. */
export type ScoutRequest = {
  question: string;
  /** The previous exchange, if any (narration only). */
  prior?: { q: string; a: string; page: number };
  docName: string;
  docHash: string;
  numPages: number;
  /** The page the student is looking at. */
  page: number;
  /** The deck digest (src/agent/context/digest.ts): byte-identical to the answer's docText. */
  digest: string;
  phase?: string;
};

/** The scout's verdict. `fallback` says why the visible page alone is used. */
export type ScoutResult = { pages: number[]; plan: string; ms: number; usd: number; fallback?: string };

export const SCOUT_MAX_PAGES = 6;
/** ≈ 80 words. */
export const SCOUT_PLAN_CHARS = 600;

/** The structured-output schema the scout model must follow. */
export const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['pages', 'plan'],
  properties: {
    pages: { type: 'array', items: { type: 'integer' }, description: 'At most 6 page numbers from the digest, in teaching order.' },
    plan: { type: 'string', description: 'At most 80 words.' },
  },
} as const;

/** The visible page alone, with the reason. */
export const fallbackScout = (page: number, why: string, ms = 0, usd = 0): ScoutResult => ({ pages: [page], plan: '', ms, usd, fallback: why });

/**
 * Parses the scout's output text. Tolerates code fences, prose around the object, page numbers as
 * strings, duplicates and out-of-range pages (dropped), more than 6 pages (cut), a long plan (cut at
 * a word). No usable page → the visible page.
 */
export function parseScout(text: string, numPages: number, visible: number): { pages: number[]; plan: string; fallback?: string } {
  let raw: unknown;
  const s = text.trim();
  try { raw = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { pages: [visible], plan: '', fallback: 'scout returned no JSON' };
    try { raw = JSON.parse(s.slice(a, b + 1)); } catch { return { pages: [visible], plan: '', fallback: 'scout returned bad JSON' }; }
  }
  if (raw == null || typeof raw !== 'object') return { pages: [visible], plan: '', fallback: 'scout returned no object' };
  const o = raw as { pages?: unknown; plan?: unknown };
  const pages: number[] = [];
  for (const v of Array.isArray(o.pages) ? o.pages : []) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/^p/i, '')) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= numPages && !pages.includes(n)) pages.push(n);
    if (pages.length >= SCOUT_MAX_PAGES) break;
  }
  const plan = clipWords(typeof o.plan === 'string' ? o.plan.replace(/\s+/g, ' ').trim() : '', SCOUT_PLAN_CHARS);
  if (!pages.length) return { pages: [visible], plan, fallback: 'scout chose no valid page' };
  return { pages, plan };
}

function clipWords(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > n * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/**
 * The pages the answer gets, in order: the visible page first (always, with its image), then the
 * scout's pages in its order. At most `max` in all.
 */
export function answerPages(visible: number, scout: number[], max = SCOUT_MAX_PAGES + 1): number[] {
  const out = [visible];
  for (const p of scout) if (!out.includes(p) && out.length < max) out.push(p);
  return out;
}

/** Which pages are sent as images: the visible page and the scout's first pages, `max` in all. */
export function imagePages(visible: number, scout: number[], max = 4): number[] {
  return answerPages(visible, scout, max);
}
