// src/agent/scout.ts — stage 1 of an answer, shared by the browser and the dev server.
//
// The scout reads the deck digest (every page, trimmed), the visible page's listing, the previous
// exchange and the question. It writes, in this order: the OPENER (the answer's first one or two
// sentences, in plain words, pointing only at the visible page), the pages the answer should teach
// from (teaching order), and a short plan. It streams (POST /api/scout → NDJSON ScoutEvents): the
// opener is spoken while the rest is still being written, and stage 2 starts as soon as the pages
// and plan are known, told exactly what the opener said. Its JSON is parsed defensively: anything
// unusable falls back to the visible page alone, so a scout failure never stops an answer.
// On a follow-up it also decides how the question relates to the previous answer (`relation`), first,
// so the opener can already speak in the new way.
import { isRelation, RELATIONS, type Relation } from './context/memory';

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
};

/** The scout's verdict. `fallback` says why the visible page alone is used. */
export type ScoutResult = { pages: number[]; plan: string; ms: number; usd: number; fallback?: string;
  /** How the question relates to the previous answer (absent: unknown, e.g. a fallback). */
  relation?: Relation;
  /** Labels or phrases the scout wants found (resolved locally into pages before stage 2). */
  find?: string[];
  /** The opener as spoken (tags included; only what passed the visible-page filter). */
  opener?: string;
  /** From the scout request to its first opener sentence. */
  openerMs?: number };

/**
 * NDJSON lines of POST /api/scout, in order: `opener` sentences (zero or more), then one `scout`
 * verdict (as soon as pages and plan are parsed; `ms` from the request), then `end` with the cost.
 */
export type ScoutEvent =
  | { t: 'opener'; d: string; ms: number }
  | { t: 'scout'; pages: number[]; plan: string; ms: number; fallback?: string; notes?: string[]; find?: string[]; relation?: Relation }
  | { t: 'end'; usd: number; ms: number; cached?: number; input?: number };

export const SCOUT_MAX_PAGES = 6;
/** ≈ 80 words. */
export const SCOUT_PLAN_CHARS = 600;
/** The scout's `find` list: at most this many short strings. */
export const SCOUT_FIND = 3;
const FIND_CHARS = 80;

/** The structured-output schema the scout model must follow. */
export const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['relation', 'opener', 'pages', 'find', 'plan'],
  // Property order is output order: the relation (a few tokens), then the opener, so it can be spoken
  // in the right way while the rest is written.
  properties: {
    relation: { type: 'string', enum: [...RELATIONS], description: 'How this question relates to your previous answer (the last in MEMORY): continue, revise-representation, simplify, new-example, deeper, or new-topic (also every first question).' },
    opener: { type: 'string', description: 'The first one or two sentences of the spoken answer, with tags that point only at the visible page.' },
    pages: { type: 'array', items: { type: 'integer' }, description: 'At most 6 page numbers of the document, in teaching order.' },
    find: { type: 'array', items: { type: 'string' }, description: 'At most 3 labels or short phrases to look up (e.g. a figure, table or equation number the answer needs); usually empty.' },
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
export function parseScout(text: string, numPages: number, visible: number): { pages: number[]; plan: string; fallback?: string; find?: string[]; relation?: Relation } {
  let raw: unknown;
  const s = text.trim();
  try { raw = JSON.parse(s); } catch {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { pages: [visible], plan: '', fallback: 'scout returned no JSON' };
    try { raw = JSON.parse(s.slice(a, b + 1)); } catch { return { pages: [visible], plan: '', fallback: 'scout returned bad JSON' }; }
  }
  if (raw == null || typeof raw !== 'object') return { pages: [visible], plan: '', fallback: 'scout returned no object' };
  const o = raw as { pages?: unknown; plan?: unknown; find?: unknown; relation?: unknown };
  const rel = isRelation(o.relation) ? { relation: o.relation } : {};
  const pages: number[] = [];
  for (const v of Array.isArray(o.pages) ? o.pages : []) {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/^p/i, '')) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= numPages && !pages.includes(n)) pages.push(n);
    if (pages.length >= SCOUT_MAX_PAGES) break;
  }
  const plan = clipWords(typeof o.plan === 'string' ? o.plan.replace(/\s+/g, ' ').trim() : '', SCOUT_PLAN_CHARS);
  const find = (Array.isArray(o.find) ? o.find : []).filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim().slice(0, FIND_CHARS)).filter(Boolean).slice(0, SCOUT_FIND);
  if (!pages.length) return { pages: [visible], plan, fallback: 'scout chose no valid page', ...(find.length ? { find } : {}), ...rel };
  return { pages, plan, ...(find.length ? { find } : {}), ...rel };
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
