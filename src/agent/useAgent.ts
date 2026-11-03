// src/agent/useAgent.ts — the agent path's per-document state for App: the context builder, the
// answer history and session memory, prewarm on intent and the spend state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdfDoc } from '../pdf/loadPdf';
import type { StudentStroke } from '../ink/student/store';
import type { Grounding } from '../geometry/resolve';
import { groundingOf, type PageGround } from './context/types';
import type { ScoutContext } from './context/build';
import type { AskContext, SpendSummary } from './protocol';
import { twoStage } from './twoStage';
import { AskError, askStream, capLine, capNotice, getSpend, scoutLive, spendBlocked, spendPhase, type AskHandlers, type ScoutLive } from './client';
import type { Route, ScoutResult } from './scout';
import { History } from './history';
import { SessionMemory, recordOf } from './context/memory';
import { checkPageOf } from './moment';
import { Prewarm } from './prewarm';
import { getSettings } from '../settings/settings';

/** What App needs from the context builder (Lane G's ContextBuilder, src/agent/context/build.ts). */
export type ContextSource = {
  warm(page: number): void;
  /** Stage 1: the deck digest (every page, trimmed). */
  digest(page: number, question?: string): Promise<string>;
  /** Stage 2: the visible page and the scout's pages (and its `find` strings, resolved locally), with their grounds. */
  build(page: number, question: string, ink: StudentStroke[], scout?: { pages: number[]; plan: string; find?: string[] }): Promise<{ context: AskContext; grounds: PageGround[]; found?: { q: string; page: number; via: string }[] }>;
  /** Stage 1, tiered (ctx=new; old mode returns the digest): everything the scout reads. */
  scout?(page: number, question: string, prior?: { q: string }): Promise<ScoutContext>;
  pagePrefix(page: number): Promise<AskContext>;
  /** The visible page's listing and ground (the opener's grounding). */
  visible(page: number): Promise<{ pageText: string; ground: PageGround }>;
  destroy(): void;
};
export type MakeContext = (doc: PdfDoc, name: string) => ContextSource;

export type AgentAsk = {
  question: string;
  page: number;
  ink: () => StudentStroke[];
  handlers: AskHandlers;
  /** The marks of the pages sent with this question, for the director's resolver. */
  onGrounding(g: Grounding): void;
  /** The grounds themselves (the live gate checks numbers and names against the pages' text). */
  onGrounds?(pages: PageGround[]): void;
  /** The text the live gate released (what played): memory records it rather than the raw stream. */
  released?(): string;
  /** The moment the question is asked in (an aside, what the student points at, a check reply): sent with stage 2, and (check, about) to the scout. */
  moment?: Pick<AskContext, 'aside' | 'replaced' | 'about' | 'check'>;
  /** The page the open check (moment.check) was offered on (moment.ts checkPageOf). Default: `page`. */
  checkPage?: number;
  /**
   * The conversation's own history and memory (a saved question keeps its own: src/session/). Default:
   * the document's. Read when asked and written when the answer ends, so a stopped answer's record lands
   * in the conversation it belongs to even after the student has moved on to another.
   */
  history?: History;
  memory?: SessionMemory;
  /** Its scout, already started (prescout: a question asked mid-answer, whose route chose this session). */
  started?: Prescout;
};

/** What the scout of a question needs, before any session exists to play its answer. */
/**
 * What the student pointed at, drew or replies to, and an aside about the paused answer, keep the answer
 * on the page it was asked on (moment.ts homePage). A question asked mid-answer is not known to be an
 * aside when its scout starts: the server pins it once the scout's route says aside (written before the
 * pages), and the session the route picks carries `moment.aside`, so both sides decide the same home.
 */
const pinnedTo = (a: Pick<AgentAsk, 'moment'>): boolean => !!(a.moment?.about || a.moment?.check || a.moment?.aside);

export type ScoutAsk = Pick<AgentAsk, 'question' | 'page' | 'moment' | 'checkPage' | 'history' | 'memory'> & {
  /** Asked mid-answer: the answer waiting paused (moment.ts asideContext): the scout decides the route from it. */
  paused?: string;
};

/**
 * A scout started ahead of its answer (src/agent/route.ts): `route` settles as soon as the scout wrote it,
 * before any opener, and the session the route picks adopts it (`AgentAsk.started`), so the question is
 * sent once. `abort` drops it (Stop, another Enter, a new document); once adopted, the session's own
 * abort does.
 */
export type Prescout = { route: Promise<Route | null>; abort(): void; /** @internal the scout under way */ live: Promise<StartedScout | null>; release(): void };

/** A scout under way, with what its stage 2 reads. */
type StartedScout = { live: ScoutLive; vis: { pageText: string; ground: PageGround }; info?: ScoutContext['info']; t0: number };

export function useAgent({ doc, name, enabled, make, warmSystem = true }: {
  doc: PdfDoc | null; name: string; enabled: boolean; make: MakeContext | null;
  /** Prewarm the shared system block when a document opens (off for replay-only eval pages). */
  warmSystem?: boolean;
}) {
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const spendRef = useRef(spend);
  spendRef.current = spend;
  const builder = useRef<ContextSource | null>(null);
  const history = useRef(new History()).current;
  /** What each answer taught (plan, board as data, claims): the follow-up's MEMORY block. */
  const memory = useRef(new SessionMemory()).current;
  const inFlight = useRef(0);
  const prewarm = useRef(new Prewarm({ inFlight: () => inFlight.current > 0, blocked: () => spendBlocked(spendRef.current) })).current;

  // One builder per opened document; history and prewarm keys go with it.
  useEffect(() => {
    if (!enabled || !doc || !make) return;
    const b = make(doc, name);
    builder.current = b;
    history.reset();
    memory.reset();
    prewarm.reset();
    b.warm(1);
    return () => { b.destroy(); if (builder.current === b) builder.current = null; };
  }, [doc, name, enabled, make, history, memory, prewarm]);

  // The system block is shared by every document: warm it once spend is known not to be blocked.
  useEffect(() => {
    if (!enabled || !doc || !warmSystem || !spend || spendBlocked(spend)) return;
    void prewarm.system();
  }, [doc, enabled, warmSystem, spend, prewarm]);

  const refreshSpend = useCallback(async () => {
    const s = await getSpend();
    if (s) setSpend(s);
    return s;
  }, []);
  useEffect(() => { if (enabled) void refreshSpend(); }, [enabled, refreshSpend]);

  /** The visible page changed: the builder warms it on scroll idle (it debounces 600ms itself). */
  const pageChanged = useCallback((page: number) => { builder.current?.warm(page); }, []);

  /** Ask-bar focus or the 3rd typed character. */
  const intent = useCallback((page: number) => {
    const b = builder.current;
    const hash = doc?.fingerprints?.[0];
    if (!b || !hash) return;
    void prewarm.intent(hash, page, () => b.pagePrefix(page));
    // A blocked state may have been lifted (the cap raised, the server restarted): look again.
    if (spendBlocked(spendRef.current)) void refreshSpend();
  }, [doc, prewarm, refreshSpend]);

  /**
   * The answer source for AnswerSession, in two stages joined into one script stream:
   *  1. the scout (streamed): its pages decide the answer's home (the page in view when relevant, else
   *     the first of them: the view travels there first), then its opener's sentences play as they arrive;
   *  2. as soon as the scout's pages and plan are in, the answer's context is built and stage 2 is
   *     asked, told exactly what the opener said; its script follows the opener's last word.
   * A failed scout falls back to the visible page alone (no opener). Aborting stops both.
   */
  /** Starts stage 1 for a question: its context (digest, visible listing, memory, the moment), then the streamed scout. Null on abort. */
  const startScout = useCallback(async (a: ScoutAsk, b: ContextSource, signal: AbortSignal): Promise<StartedScout | null> => {
    const t0 = performance.now();
    const phase = spendPhase(spendRef.current);
    const H = a.history ?? history, M = a.memory ?? memory;
    const hist = H.last();
    const prior = hist[hist.length - 1];
    const hash = doc?.fingerprints?.[0] ?? name;
    const mem = M.text();
    const sc0 = b.scout ? await b.scout(a.page, a.question, prior) : null;
    const [digest, vis] = sc0 ? [sc0.digest, { pageText: sc0.pageText, ground: sc0.ground }] : await Promise.all([b.digest(a.page, a.question), b.visible(a.page)]);
    if (signal.aborted) return null;
    const live = scoutLive({
      question: a.question, ...(prior ? { prior } : {}), docName: name, docHash: hash, numPages: doc?.numPages ?? a.page,
      page: a.page, digest, pageText: vis.pageText, ...(phase ? { phase } : {}),
      ...(sc0?.section ? { section: sc0.section } : {}), ...(mem ? { memory: mem } : {}),
      ...(sc0?.candidates ? { candidates: sc0.candidates } : {}), ...(sc0?.image ? { image: sc0.image } : {}),
      ...(a.moment?.check ? { check: { q: a.moment.check, page: a.checkPage ?? a.page } } : {}), ...(a.moment?.about ? { about: a.moment.about } : {}),
      ...(pinnedTo(a) ? { pinned: true } : {}), ...(a.paused ? { paused: a.paused } : {}),
    }, signal);
    return { live, vis, ...(sc0 ? { info: sc0.info } : {}), t0 };
  }, [history, memory, doc, name]);

  /**
   * A question asked mid-answer: its scout starts now, with the paused answer, before App knows which
   * session will play it (src/agent/route.ts). Never throws; with no builder the route is null (aside).
   */
  const prescout = useCallback((a: ScoutAsk): Prescout => {
    const ctl = new AbortController();
    const b = builder.current;
    inFlight.current++;
    let held = true;
    const release = () => { if (held) { held = false; inFlight.current--; } };
    const live = b ? startScout(a, b, ctl.signal).catch(() => null) : Promise.resolve(null);
    return {
      live,
      route: live.then((s) => (s ? s.live.route : null)),
      abort: () => { ctl.abort(); release(); },
      release,
    };
  }, [startScout]);

  const source = useCallback((a: AgentAsk) => async function* (signal: AbortSignal): AsyncGenerator<string> {
    const b = builder.current;
    // E1 integration point: without Lane G's builder there is no context to send.
    if (!b) { a.started?.abort(); throw new AskError('network', "Couldn't reach the tutor.", true); }
    if (!a.started) inFlight.current++;
    // An adopted scout ends with this session.
    const drop = () => a.started?.abort();
    signal.addEventListener('abort', drop);
    try {
      const phase = spendPhase(spendRef.current);
      // Answer quality: a choice token only, and only when the server says Best can run (the model is the server's to pick).
      const best = getSettings().quality === 'best' && !!spendRef.current?.best;
      const H = a.history ?? history, M = a.memory ?? memory;
      const st = a.started ? await a.started.live : await startScout(a, b, signal);
      if (!st || signal.aborted) return;
      const { live, vis, t0 } = st;
      const since = () => Math.round(performance.now() - t0);
      // Read when stage 2 is asked, not when the scout started: an answer this one replaced has ended
      // since, and its exchange and record are the previous answer now.
      const mem = () => M.text();
      // The session memory records what this answer taught once it has played (or was stopped).
      let script = '';
      let taught: number[] = [];
      let plan = '';
      let relation: ScoutResult['relation'];
      // The answer's own plan (done.plan): the svg board's layout, kept for a follow-up that extends it.
      let answerPlan = '';
      /** The hidden check it ended on (done.check): memory records it with its page. */
      let check = '';
      const handlers: AskHandlers = { ...a.handlers, onDone: (e) => { answerPlan = e.plan ?? ''; check = e.check ?? ''; a.handlers.onDone?.(e); } };
      const stream = twoStage({
        live, visible: vis.ground, handlers, since, ...(st.info ? { ctx: st.info } : {}),
        pinned: pinnedTo(a),
        // Stage 2 is built on the answer's home (twoStage): the page in view by the time it speaks.
        build: async (sc, home) => {
          const r = await b.build(home, a.question, a.ink(), { pages: sc.pages, plan: sc.plan, ...(sc.find?.length ? { find: sc.find } : {}) });
          for (const f of r.found ?? []) a.handlers.onNote?.(`find "${f.q}" → p${f.page} (${f.via})`);
          taught = r.context.scout?.pages ?? sc.pages;
          plan = sc.plan;
          relation = sc.relation;
          // A follow-up: stage 2 gets the MEMORY block and how this question relates to the last answer.
          const scout = r.context.scout && relation ? { scout: { ...r.context.scout, relation } } : {};
          const m = mem();
          return { ...r, context: { ...r.context, ...scout, ...(m ? { memory: m } : {}), ...a.moment } };
        },
        ask: (context) => askStream({ question: a.question, history: H.last(), context, ...(phase ? { phase } : {}), ...(best ? { quality: 'best' as const } : {}) }, signal, handlers),
        onGrounding: (pages) => { a.onGrounding(groundingOf(pages)); a.onGrounds?.(pages); },
      }, signal);
      try {
        for await (const c of stream) { script += c; yield c; }
      } finally {
        // What played, not what was streamed: a unit the gate dropped was never said or drawn.
        const said = a.released ? a.released() : script;
        if (said.trim()) M.add(recordOf({ question: a.question, page: a.page, pages: taught, plan, script: said, ...(answerPlan ? { answerPlan } : {}), ...(check ? { check, checkPage: checkPageOf(said, a.page) } : {}), ...(relation ? { relation } : {}), ...(signal.aborted ? { stopped: true } : {}) }));
      }
    } finally {
      signal.removeEventListener('abort', drop);
      if (a.started) a.started.release(); else inFlight.current--;
    }
  }, [history, memory, startScout]);

  // The student's line; the developer's (which cap, the knob) only in ?debug and the console.
  const blocked = useMemo(() => (spendBlocked(spend) ? capNotice(spend) : undefined), [spend]);
  const blockedDetail = useMemo(() => (spendBlocked(spend) ? capLine(spend) : undefined), [spend]);
  useEffect(() => { if (blockedDetail && import.meta.env.DEV) console.info('[spend]', blockedDetail); }, [blockedDetail]);

  /** The grounding of `pages` (eval replays: the pages the recorded answer was given). */
  const grounds = useCallback(async (page: number, pages: number[] = []): Promise<PageGround[]> => {
    const b = builder.current;
    return b ? (await b.build(page, '', [], { pages, plan: '' })).grounds : [];
  }, []);

  return { spend, blocked, blockedDetail, refreshSpend, pageChanged, intent, source, prescout, history, memory, grounds };
}
