// src/agent/scout.ts — stage 1 of an answer, shared by the browser and the dev server.
//
// The scout reads the deck digest (every page, trimmed), the visible page's listing, the previous
// exchange and the question. It writes, in this order: the OPENER (the answer's first one or two
// sentences, in plain words, pointing only at the visible page), the pages the answer should teach
// from (teaching order), and a short plan. It streams (POST /api/scout → NDJSON ScoutEvents): the
// opener is spoken while the rest is still being written, and stage 2 starts as soon as the pages
// and plan are known, told exactly what the opener said. Its JSON is parsed defensively: anything
// unusable falls back to the visible page alone, so a scout failure never stops an answer.
// On a follow-up it also decides how the question relates to the previous answer (`relation`), so the
// opener can already speak in the new way.
// Asked while an answer plays (the student typed over it, so it waits paused: `paused`), it decides first
// where the question goes (`route`): `aside`, a side question answered briefly before the paused answer
// goes on, or `new`, the student wants this answered instead and the paused answer ends where it is.
// The route is the first field written and travels as its own event, so the app knows where the answer
// will play before its first word, at no added latency (src/agent/route.ts decides with it).
import { isRelation, RELATIONS, type Relation } from './context/memory';

/** Where a question asked mid-answer goes: beside the paused answer, or in its place. */
export const ROUTES = ['aside', 'new'] as const;
export type Route = (typeof ROUTES)[number];
export const isRoute = (v: unknown): v is Route => typeof v === 'string' && (ROUTES as readonly string[]).includes(v);

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
  /** The visible page's listing (lines + marks, no image): what the opener may point at. */
  pageText?: string;
  phase?: string;
  // Tiered context (ctx=new; src/agent/context/tiers.ts). All optional: without them the request is as before.
  /** Huge documents: the visible section at full detail (cached after the digest/map). */
  section?: string;
  /** A scanned page or one whose equations are drawn as outlines: its image, read at low detail. */
  image?: { b64: string; w: number; h: number };
  /** Session MEMORY (src/agent/context/memory.ts): earlier answers' plans, boards and claims (append-only, cached at its end). */
  memory?: string;
  /** Per question (uncached, before the question): CANDIDATES and the printed-page note. */
  candidates?: string;
  /**
   * The moment it is asked in (per question, uncached), as stage 2 gets it: the open check question this
   * may reply to and the page it was offered on, and what the student pointed at. Without them the scout
   * chose the opener and pages for a bare reply ("0.5") from a possibly different page.
   */
  check?: { q: string; page: number };
  about?: string;
  /**
   * Asked mid-answer: the answer that waits paused (its question, plan, what it has said, its board;
   * moment.ts asideContext). The scout decides the route from it. Absent: no answer is playing.
   */
  paused?: string;
};

/** The scout's verdict. `fallback` says why the visible page alone is used. */
export type ScoutResult = { pages: number[]; plan: string; ms: number; usd: number; fallback?: string;
  /** How the question relates to the previous answer (absent: unknown, e.g. a fallback). */
  relation?: Relation;
  /** Asked mid-answer (`paused` sent): where it goes. Absent otherwise, or when the scout gave none. */
  route?: Route;
  /** Labels or phrases the scout wants found (resolved locally into pages before stage 2). */
  find?: string[];
  /** The opener as spoken (tags included; only what passed the visible-page filter). */
  opener?: string;
  /** From the scout request to its first opener sentence. */
  openerMs?: number };

/**
 * NDJSON lines of POST /api/scout, in order: the `route` (only when the request had `paused`, as soon as
 * the field closes, before any opener), `opener` sentences (zero or more), then one `scout` verdict (as
 * soon as pages and plan are parsed; `ms` from the request), then `end` with the cost.
 */
export type ScoutEvent =
  | { t: 'route'; route: Route; ms: number }
  | { t: 'opener'; d: string; ms: number }
  | { t: 'scout'; pages: number[]; plan: string; ms: number; fallback?: string; notes?: string[]; find?: string[]; relation?: Relation; route?: Route }
  | { t: 'end'; usd: number; ms: number; cached?: number; input?: number };

export const SCOUT_MAX_PAGES = 6;
/** ≈ 100 words (the plan ends with its numbered beats and scope, so a clip must not cut them). */
export const SCOUT_PLAN_CHARS = 750;
/** The scout's `find` list: at most this many short strings. */
export const SCOUT_FIND = 3;
const FIND_CHARS = 80;

/** The structured-output schema the scout model must follow. */
export const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['route', 'relation', 'opener', 'pages', 'find', 'plan'],
  // Property order is output order: the route and the relation (a few tokens each), then the opener, so
  // the app knows where it plays and it can be spoken in the right way while the rest is written.
  // One schema for every question (a second one would miss the cached prefix): with no paused answer the
  // route is "new" and nothing reads it.
  properties: {
    route: { type: 'string', enum: [...ROUTES], description: 'Only when a PAUSED ANSWER is given: aside (a side question, after which the paused answer goes on) or new (answer this instead; the paused answer ends). With no paused answer: new.' },
    relation: { type: 'string', enum: [...RELATIONS], description: 'How this question relates to your previous answer (the last in MEMORY): continue, revise-representation, simplify, new-example, deeper, or new-topic (also every first question).' },
    opener: { type: 'string', description: 'The first one or two sentences of the spoken answer, with tags that point only at the visible page.' },
    pages: { type: 'array', items: { type: 'integer' }, description: 'At most 6 page numbers of the document, in teaching order.' },
    find: { type: 'array', items: { type: 'string' }, description: 'At most 3 labels or short phrases to look up (e.g. a figure, table or equation number the answer needs); usually empty.' },
    plan: { type: 'string', description: 'At most 100 words, ending with the numbered beats and the scope (narrow, standard or broad).' },
  },
} as const;

/** The visible page alone, with the reason. */
export const fallbackScout = (page: number, why: string, ms = 0, usd = 0): ScoutResult => ({ pages: [page], plan: '', ms, usd, fallback: why });

/**
 * Parses the scout's output text. Tolerates code fences, prose around the object, page numbers as
 * strings, duplicates and out-of-range pages (dropped), more than 6 pages (cut), a long plan (cut at
 * a word). No usable page → the visible page.
 */
export function parseScout(text: string, numPages: number, visible: number): { pages: number[]; plan: string; fallback?: string; find?: string[]; relation?: Relation; route?: Route } {
  let raw: unknown;
  const s = text.trim();
  try { raw = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { pages: [visible], plan: '', fallback: 'scout returned no JSON' };
    try { raw = JSON.parse(s.slice(a, b + 1)); } catch { return { pages: [visible], plan: '', fallback: 'scout returned bad JSON' }; }
  }
  if (raw == null || typeof raw !== 'object') return { pages: [visible], plan: '', fallback: 'scout returned no object' };
  const o = raw as { pages?: unknown; plan?: unknown; find?: unknown; relation?: unknown; route?: unknown };
  const rel = { ...(isRelation(o.relation) ? { relation: o.relation } : {}), ...(isRoute(o.route) ? { route: o.route } : {}) };
  const pages: number[] = [];
  for (const v of Array.isArray(o.pages) ? o.pages : []) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/^p/i, '')) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= numPages && !pages.includes(n)) pages.push(n);
    if (pages.length >= SCOUT_MAX_PAGES) break;
  }
  const plan = clipPlan(typeof o.plan === 'string' ? o.plan.replace(/\s+/g, ' ').trim() : '', SCOUT_PLAN_CHARS);
  const find = (Array.isArray(o.find) ? o.find : []).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim().slice(0, FIND_CHARS)).filter(Boolean).slice(0, SCOUT_FIND);
  if (!pages.length) return { pages: [visible], plan, fallback: 'scout chose no valid page', ...(find.length ? { find } : {}), ...rel };
  return { pages, plan, ...(find.length ? { find } : {}), ...rel };
}

/**
 * A long plan is cut in its prose, never in its tail: the numbered beats and the scope are the answer's
 * length budget (src/agent/pacing.ts), so they are kept whole (a run cut "4. Check half versus full orbit.…"
 * and lost its scope).
 */
export function clipPlan(s: string, n: number): string {
  if (s.length <= n) return s;
  const at = s.search(/(?:\bBeats?\s*:\s*)?(?:^|[\s;:])1[.)]?\s+(?=\p{L})(?![^]*(?:^|[\s;:])1[.)]\s+\p{L})/u);
  const tail = at > 0 ? s.slice(at).trim() : (/\bscope\s*:\s*\w+\.?$/i.exec(s)?.[0] ?? '');
  if (!tail || tail.length > n * 0.6) return clipWords(s, n);
  return `${clipWords(s.slice(0, at > 0 ? at : s.length - tail.length).trim(), n - tail.length - 1)} ${tail}`;
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
