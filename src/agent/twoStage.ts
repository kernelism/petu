// src/agent/twoStage.ts — one answer as one script stream, from two model calls (spec "Lessons v3" A):
//
//   scout (streamed) ── pages ─► home ── opener sentences ─► played at once (on the home page)
//                    └─ verdict (pages, plan) ─► build ─► stage 2 ─► played right after the opener
//
// Stage 2 starts the moment the verdict is in, while the opener is still being spoken, and is told
// the opener verbatim so it continues instead of repeating. The player sees one stream: an opening
// move to the home page when the answer lives elsewhere, the opener's text, a separating space, then
// stage 2's text, never interleaved.
//
// The home (moment.ts homePage) is where the answer is spoken from its first word: the page the
// question was asked on when the scout's pages include it, else the first of them. The scout writes
// its pages before its opener, so the home is known before the first word: the stream opens with
// `{{scroll p=home}}` at word 0 (no journey beat: nothing was said yet; deriveParts makes it the first
// part's page), stage 2 is built on the home page (its listing and image, "the student is looking at"
// it, since by then they are), and the server's opener gate let the opener point only at the home page.
// Was: the opener on the asked page and the first move only at stage 2's first scroll, ~10 s in.
// A question asked mid-answer has its scout started earlier (useAgent.prescout): its route was read
// before this ran (src/agent/route.ts); here the route only rides the `scout` event, for the record.
// An aside is pinned (its home is the page asked on); the server's gate pins it by the same route.
import type { AskContext, AskEvent } from './protocol';
import { AskError, capNotice, type AskHandlers, type ScoutLive } from './client';
import type { ScoutResult } from './scout';
import type { PageGround } from './context/types';
import { homePage } from './moment';

export type TwoStage = {
  live: ScoutLive;
  /** The visible page's ground (the page asked on): what the opener's tags resolve against. */
  visible: PageGround;
  /** The question is pinned to the page asked on (the student pointed or drew on it, or replies to a check offered there): it is the home whatever the pages. */
  pinned?: boolean;
  /** Stage 2's context, built on the answer's home page. */
  build(sc: ScoutResult, home: number): Promise<{ context: AskContext; grounds: PageGround[] }>;
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
  const asked = o.visible.page;
  /** Decided once, from the first pages known: the early ones before the first word, else the verdict's (no opener). */
  let home: number | null = null;
  const homeOf = (pages: number[] | null) => (home ??= homePage(asked, pages ?? [], o.pinned));
  /** The opening move: before the first word, to the home page when it is not the page asked on. */
  let moved = false;
  const move = (): string => {
    if (moved) return '';
    moved = true;
    return home != null && home !== asked ? `{{scroll p=${home}}} ` : '';
  };
  const stage2 = o.live.verdict.then(async (sc) => {
    if (!sc || signal.aborted) return null;
    // Pages that were not early, behind an opener, came too late: the opener is on the page asked on
    // (the server's gate kept its tags there), whichever of the two the generator reaches first.
    homeOf(o.live.pages() ?? (sc.opener ? [] : sc.pages));
    const atMs = o.since();
    void o.live.cost.then((c) => {
      if (signal.aborted) return;
      const ev: Extract<AskEvent, { t: 'scout' }> = {
        t: 'scout', pages: sc.pages, plan: sc.plan, ms: sc.ms, atMs, usd: c.usd, ...(sc.fallback ? { fallback: sc.fallback } : {}),
        ...(sc.openerMs != null ? { openerMs: sc.openerMs } : {}), ...(sc.opener ? { opener: sc.opener } : {}),
        ...(c.cached != null ? { cached: c.cached } : {}), ...(c.input != null ? { input: c.input } : {}),
        ...(sc.find?.length ? { find: sc.find } : {}), ...(sc.relation ? { relation: sc.relation } : {}), ...(sc.route ? { route: sc.route } : {}), ...(home !== asked ? { home: home! } : {}), ...(o.ctx ? { ctx: o.ctx } : {}),
      };
      o.handlers.onEvent?.(ev);
      o.handlers.onScout?.(ev);
    });
    const { context, grounds } = await o.build(sc, home!);
    if (signal.aborted) return null;
    return { grounds, stream: o.ask(sc.opener ? { ...context, opener: sc.opener } : context) };
  });
  // A stage-2 failure must not surface before the opener has been yielded (it is awaited below).
  stage2.catch(() => undefined);

  let opened = false;
  for await (const s of o.live.opener) {
    if (signal.aborted) return;
    // The first sentence: the pages came before it (or never early: then the page asked on).
    if (!opened) { homeOf(o.live.pages()); const m = move(); if (m) yield m; }
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
        // No opener: stage 2's first text is the answer's first word, and the opening move goes before it.
        const m = move();
        if (m) yield m;
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
    if (opened && !signal.aborted) { o.handlers.onCutOff?.(e instanceof AskError && !e.retryable ? (e.code === 'cap' ? capNotice(null, e.message) : e.message) : 'The answer was cut off.'); return; }
    throw e;
  }
}
