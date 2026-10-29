// src/agent/protocol.ts — shared by the browser (src/agent/client.ts) and the dev server (server/).
import type { Usage } from '../../server/prices';
import type { Storyboard } from './storyboard';
import type { Relation } from './context/memory';

/** What the browser sends to POST /api/ask (and /api/prewarm, without question/history/ink). */
export type AskRequest = {
  question: string;
  /** Last ≤ 3 answers, oldest first; narration only (tags stripped). */
  history: { q: string; a: string; page: number }[];
  context: AskContext;
  /** Eval runs tag their spend; the server also reads PETU_PHASE. */
  phase?: string;
};

/** Built by src/agent/context/build.ts. Text blocks are already formatted for the model. */
export type AskContext = {
  docName: string;
  /** Stable per document (pdf.js fingerprint): the prompt cache key and the prewarm key. */
  docHash: string;
  numPages: number;
  page: number;
  /** Cached block, part 1: the deck digest (every page, trimmed; src/agent/context/digest.ts). Constant per document. */
  docText: string;
  /** Cached block, part 2: the visible page's listing (text lines + marks). */
  pageText: string;
  /** Prewarm only (ctx=new, huge documents): the scout's section card, so prewarm writes the scout's whole prefix. */
  scoutSection?: string;
  /** JPEG of the visible page, base64 (no data: prefix). */
  image: { b64: string; w: number; h: number };
  /** Volatile tail: the listings (lines + marks) of the scout's other pages, in teaching order. */
  pagesText?: string;
  /** Volatile tail: JPEGs of the scout's first other pages (with the visible page, at most 4 images). */
  images?: { page: number; b64: string; w: number; h: number }[];
  /** Volatile tail: the scout's pages (teaching order), plan, and how the question relates to the previous answer. */
  scout?: { pages: number[]; plan: string; relation?: Relation };
  /**
   * Session MEMORY (src/agent/context/memory.ts): what earlier answers taught (plan, board as data,
   * claims, check question). Append-only per session; sent after the page block with its own breakpoint.
   */
  memory?: string;
  /**
   * Volatile tail: the opener the scout wrote, already spoken (and its marks drawn) before this
   * answer's first word. The answer continues from it without repeating it.
   */
  opener?: string;
  /** Volatile tail: keyword hits from pages not already included (v2 contexts; v3 sends the digest instead). */
  searchText?: string;
  /** Volatile tail: student ink on the visible page. */
  ink?: { summary: string; crop?: { b64: string; w: number; h: number } };
};

/** NDJSON lines from the server, one JSON object per line. */
export type AskEvent =
  | { t: 'meta'; reqId: string; model: string; effort: string }
  /** Client-side: the scout's verdict (stage 1), recorded before the answer's own events. */
  | { t: 'scout'; pages: number[]; plan: string; ms: number; usd: number; fallback?: string;
      /** `ms`: the scout call to its verdict. `atMs`: the verdict, from Enter. `openerMs`: the call to its
       * first opener sentence. `opener`: what the opener said (script). `cached`/`input`: its tokens. */
      atMs?: number; openerMs?: number; opener?: string; cached?: number; input?: number;
      /** The scout's `find` strings, and the context it read (?debug: tier, tokens per block, candidate pages). */
      find?: string[]; relation?: Relation; ctx?: { mode: string; tier: string; tokens: Record<string, number>; candidates: string[]; printedOffset?: number; ms: number } }
  /** Client-side: stage 2's first text reached the player (ms from Enter); the opener's words were then due to end at `openerEndMs`. */
  | { t: 'handoff'; ms: number; openerEndMs?: number }
  /**
   * The lesson design (server, before stage 2's meta): `ms` from the ask request to the storyboard
   * (or its fallback), its cost and tokens. `fallback` says why stage 2 runs on the scout's plan alone.
   */
  | { t: 'storyboard'; ms: number; usd: number; model: string; effort: string; version: string; board?: Storyboard; fallback?: string;
      estimated?: boolean; input?: number; cached?: number; output?: number; reasoning?: number }
  | { t: 'text'; d: string }
  | { t: 'note'; message: string }
  | { t: 'done'; usage?: Usage; usd: number; estimated?: boolean; spentUsd: number; capUsd: number; ttftMs: number; plan?: string; lint?: string[] }
  | { t: 'error'; code: AskErrorCode; message: string; retryable: boolean };

export type AskErrorCode = 'no_key' | 'cap' | 'rate_limited' | 'upstream' | 'network' | 'bad_request' | 'cut_off';

/** GET /api/spend. `phase`/`phaseCapUsd`/`blocked` come from the server route; the breakdowns from the ledger. */
export type SpendSummary = {
  totalUsd: number;
  capUsd: number;
  /** Founder-phase spend of the local day: what the daily cap counts. */
  todayUsd: number;
  /** Spend of the local day across all phases. */
  todayAllUsd?: number;
  dailyCapUsd?: number;
  /** The server's spend phase (dev | bakeoff | iterate | validate | founder | lessondev | lessonbake | lessoniter | lessonval). */
  phase?: string;
  /** The current phase's budget. */
  phaseCapUsd?: number;
  /** Set when the next answer would be refused: the refusal line. */
  blocked?: string;
  /** Which cap `blocked` names. */
  blockedCode?: 'total' | 'daily' | 'phase';
  byPhase?: Record<string, number>;
  byModel?: Record<string, number>;
  /** Ledger entries. */
  n?: number;
};

/** The checkpoint's hard stop: PETU_TOTAL_CAP_USD may only lower it (server/env.ts). */
export const HARD_STOP_USD = 40;

/**
 * Dollars for people: cents from $0.10 up; below that, two significant digits so small amounts stay
 * readable ("$0.014 of $0.020", not "$0.01 of $0.02").
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0.00';
  const a = Math.abs(n);
  const d = a >= 0.1 ? 2 : Math.min(6, 1 - Math.floor(Math.log10(a)));
  return `${n < 0 ? '-' : ''}$${a.toFixed(d)}`;
}
