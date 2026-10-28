// src/agent/protocol.ts — shared by the browser (src/agent/client.ts) and the dev server (server/).
import type { Usage } from '../../server/prices';

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
  /** Cached block, part 1: document header + outline. */
  docText: string;
  /** Cached block, part 2: visible page (text lines + marks) and neighbours' text lines. */
  pageText: string;
  /** JPEG of the visible page, base64 (no data: prefix). */
  image: { b64: string; w: number; h: number };
  /** Volatile tail: keyword hits from pages not already included. */
  searchText?: string;
  /** Volatile tail: student ink on the visible page. */
  ink?: { summary: string; crop?: { b64: string; w: number; h: number } };
};

/** NDJSON lines from the server, one JSON object per line. */
export type AskEvent =
  | { t: 'meta'; reqId: string; model: string; effort: string }
  | { t: 'text'; d: string }
  | { t: 'note'; message: string }
  | { t: 'done'; usage?: Usage; usd: number; estimated?: boolean; spentUsd: number; capUsd: number; ttftMs: number; plan?: string; lint?: string[] }
  | { t: 'error'; code: AskErrorCode; message: string; retryable: boolean };

export type AskErrorCode = 'no_key' | 'cap' | 'rate_limited' | 'upstream' | 'network' | 'bad_request' | 'cut_off';

export type SpendSummary = { totalUsd: number; capUsd: number; todayUsd: number; dailyCapUsd?: number; blocked?: string };
