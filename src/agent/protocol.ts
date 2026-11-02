// src/agent/protocol.ts — shared by the browser (src/agent/client.ts) and the dev server (server/).
import type { Usage } from '../../server/prices';
import type { Relation } from './context/memory';
import type { GateEvent, RepairEvent, RepairRequest } from '../gate/events';

/** What the browser sends to POST /api/ask (and /api/prewarm, without question/history/ink). */
export type AskRequest = {
  question: string;
  /** Last ≤ 3 answers, oldest first; narration only (tags stripped). */
  history: { q: string; a: string; page: number }[];
  context: AskContext;
  /** Eval runs tag their spend; the server also reads PETU_PHASE. */
  phase?: string;
  /** The answer model as a choice, never a name: the server maps it (server/quality.ts). Absent = 'standard'. */
  quality?: AnswerQuality;
};

/** Settings → Answer quality. 'standard' = the server's default model; 'best' = its opt-in best model. */
export const ANSWER_QUALITIES = ['standard', 'best'] as const;
export type AnswerQuality = (typeof ANSWER_QUALITIES)[number];

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
  /** Volatile tail: student ink on the visible page. */
  ink?: { summary: string; crop?: { b64: string; w: number; h: number } };
  /**
   * Volatile tail, the moment the question is asked in (v1 learner UX; src/agent/moment.ts):
   * `aside`: asked mid-answer, which waits paused (its plan, what it has said, its board);
   * `about`: what the student pointed at (a selection, or a region circled on a page or the board);
   * `check`: the answer ended on this question to the student, and the question is their reply.
   */
  aside?: string;
  about?: string;
  check?: string;
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
  | { t: 'text'; d: string }
  | { t: 'note'; message: string }
  | { t: 'done'; usage?: Usage; usd: number; estimated?: boolean; spentUsd: number; capUsd: number; ttftMs: number; plan?: string; /** The hidden check question (p6.2), offered as "Test yourself" after the answer: never spoken. */ check?: string; lint?: string[] }
  | { t: 'error'; code: AskErrorCode; message: string; retryable: boolean }
  /** Client-side: the live gate's verdicts and repairs (src/gate/live.ts), recorded with the answer. */
  | GateEvent
  | RepairEvent;

/**
 * POST /api/repair (design §6): the gate's RepairRequest plus the answer it repairs (`reqId`, from
 * stage 2's `meta`) and the spend phase. Response: NDJSON RepairWireEvents.
 */
export type RepairWire = RepairRequest & { reqId: string; phase?: string };
/** /api/repair's NDJSON lines: the replacement's text, then done (cost) or error. */
export type RepairWireEvent =
  | { t: 'text'; d: string }
  | { t: 'done'; usd: number; estimated?: boolean; ms: number; lint?: string[] }
  | { t: 'error'; code: 'not_found' | 'too_many' | 'bad_request' | 'cap' | 'off' | 'upstream' | 'network' | 'late' | 'no_key'; message: string; usd?: number };

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
  /** The server's answer model, and which provider keys it has (never the keys themselves). */
  model?: string;
  keys?: { openai: boolean; anthropic: boolean };
  /** Whether Answer quality "Best" can run (its model's key is set). A boolean, never the key. */
  best?: boolean;
  /** Set when the next answer would be refused: the refusal line. */
  blocked?: string;
  /** Which cap `blocked` names. */
  blockedCode?: 'total' | 'daily' | 'phase';
  byPhase?: Record<string, number>;
  byModel?: Record<string, number>;
  /** Ledger entries. */
  n?: number;
};

/** The hard stop (raised from $40 to $60 by the founder, 2026-10-28, for the author benchmark): PETU_TOTAL_CAP_USD may only lower it (server/env.ts). */
export const HARD_STOP_USD = 80;

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
