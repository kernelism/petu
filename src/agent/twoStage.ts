// src/agent/twoStage.ts — one answer as one script stream, from two model calls (spec "Lessons v3" A):
//
//   scout (streamed) ── opener sentences ──────────────► played at once (visible page only)
//                    └─ verdict (pages, plan) ─► build ─► stage 2 ─► played right after the opener
//
// Stage 2 starts the moment the verdict is in, while the opener is still being spoken, and is told
// the opener verbatim so it continues instead of repeating. The player sees one stream: the opener's
// text, a separating space, then stage 2's text, never interleaved.
import type { AskContext, AskEvent } from './protocol';
import { AskError, type AskHandlers, type ScoutLive } from './client';
import type { ScoutResult } from './scout';
import type { PageGround } from './context/types';

export type TwoStage = {
  live: ScoutLive;
  /** The visible page's ground: what the opener's tags resolve against. */
  visible: PageGround;
  build(sc: ScoutResult): Promise<{ context: AskContext; grounds: PageGround[] }>;
  /** Stage 2's script stream for a context (askStream). */
  ask(context: AskContext): AsyncGenerator<string>;
  onGrounding(pages: PageGround[]): void;
  handlers: AskHandlers;
  /** ms since Enter. */
  since(): number;
  /** ?debug: the context the scout read (tier, tokens per block, candidate pages). */
  ctx?: NonNullable<Extract<AskEvent, { t: 'scout' }>['ctx']>;
};

export async function* twoStage(o: TwoStage, signal: AbortSignal): AsyncGenerator<string> {
  o.onGrounding([o.visible]);
  const stage2 = o.live.verdict.then(async (sc) => {
    if (!sc || signal.aborted) return null;
    const atMs = o.since();
    void o.live.cost.then((c) => {
      if (signal.aborted) return;
      const ev: Extract<AskEvent, { t: 'scout' }> = {
        t: 'scout', pages: sc.pages, plan: sc.plan, ms: sc.ms, atMs, usd: c.usd, ...(sc.fallback ? { fallback: sc.fallback } : {}),
        ...(sc.openerMs != null ? { openerMs: sc.openerMs } : {}), ...(sc.opener ? { opener: sc.opener } : {}),
        ...(c.cached != null ? { cached: c.cached } : {}), ...(c.input != null ? { input: c.input } : {}),
        ...(sc.find?.length ? { find: sc.find } : {}), ...(sc.relation ? { relation: sc.relation } : {}), ...(o.ctx ? { ctx: o.ctx } : {}),
      };
      o.handlers.onEvent?.(ev);
      o.handlers.onScout?.(ev);
    });
    const { context, grounds } = await o.build(sc);
    if (signal.aborted) return null;
    return { grounds, stream: o.ask(sc.opener ? { ...context, opener: sc.opener } : context) };
  });
  // A stage-2 failure must not surface before the opener has been yielded (it is awaited below).
  stage2.catch(() => undefined);

  let opened = false;
  for await (const s of o.live.opener) {
    if (signal.aborted) return;
    opened = true;
    yield s;
  }
  try {
    const st = await stage2;
    if (!st || signal.aborted) return;
    // Every page sent with a listing (the visible page included) can now be marked.
    o.onGrounding(st.grounds);
    let first = true;
    for await (const c of st.stream) {
      if (signal.aborted) return;
      if (first) {
        first = false;
        const ev: Extract<AskEvent, { t: 'handoff' }> = { t: 'handoff', ms: o.since() };
        o.handlers.onHandoff?.(ev); // may add when the opener's words end
        o.handlers.onEvent?.(ev);
        // The opener ends on a sentence; keep the next word apart from it.
        if (opened && !/^\s/.test(c)) yield ' ';
      }
      yield c;
    }
  } catch (e) {
    // After the opener has been spoken, a failed stage 2 is a cut-off answer (what played stays),
    // not an error that wipes the caption.
    // A refusal that a retry won't fix (a spending cap) keeps its reason.
    if (opened && !signal.aborted) { o.handlers.onCutOff?.(e instanceof AskError && !e.retryable ? e.message : 'The answer was cut off.'); return; }
    throw e;
  }
}
