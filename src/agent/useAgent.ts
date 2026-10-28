// src/agent/useAgent.ts — the agent path's per-document state for App: the context builder, the
// answer history, prewarm on intent and the spend state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PdfDoc } from '../pdf/loadPdf';
import type { StudentStroke } from '../ink/student/store';
import type { Grounding } from '../geometry/resolve';
import { groundingOf, type PageGround } from './context/types';
import type { AskContext, SpendSummary } from './protocol';
import { AskError, askStream, capLine, getSpend, scoutPages, spendBlocked, spendPhase, type AskHandlers } from './client';
import { History } from './history';
import { Prewarm } from './prewarm';

/** What App needs from the context builder (Lane G's ContextBuilder, src/agent/context/build.ts). */
export type ContextSource = {
  warm(page: number): void;
  /** Stage 1: the deck digest (every page, trimmed). */
  digest(page: number, question?: string): Promise<string>;
  /** Stage 2: the visible page and the scout's pages, with their grounds. */
  build(page: number, question: string, ink: StudentStroke[], scout?: { pages: number[]; plan: string }): Promise<{ context: AskContext; grounds: PageGround[] }>;
  pagePrefix(page: number): Promise<AskContext>;
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
};

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
  const inFlight = useRef(0);
  const prewarm = useRef(new Prewarm({ inFlight: () => inFlight.current > 0, blocked: () => spendBlocked(spendRef.current) })).current;

  // One builder per opened document; history and prewarm keys go with it.
  useEffect(() => {
    if (!enabled || !doc || !make) return;
    const b = make(doc, name);
    builder.current = b;
    history.reset();
    prewarm.reset();
    b.warm(1);
    return () => { b.destroy(); if (builder.current === b) builder.current = null; };
  }, [doc, name, enabled, make, history, prewarm]);

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

  /** The answer source for AnswerSession: build the context, then stream the script. */
  const source = useCallback((a: AgentAsk) => async function* (signal: AbortSignal): AsyncGenerator<string> {
    const b = builder.current;
    // E1 integration point: without Lane G's builder there is no context to send.
    if (!b) throw new AskError('network', "Couldn't reach the tutor.", true);
    inFlight.current++;
    try {
      const phase = spendPhase(spendRef.current);
      const hist = history.last();
      const prior = hist[hist.length - 1];
      const hash = doc?.fingerprints?.[0] ?? name;
      // Stage 1: the scout picks the pages to teach from (falls back to this page on any failure).
      const digest = await b.digest(a.page, a.question);
      if (signal.aborted) return;
      const scout = await scoutPages({
        question: a.question, ...(prior ? { prior } : {}), docName: name, docHash: hash, numPages: doc?.numPages ?? a.page,
        page: a.page, digest, ...(phase ? { phase } : {}),
      }, signal);
      if (!scout || signal.aborted) return;
      const ev = { t: 'scout' as const, pages: scout.pages, plan: scout.plan, ms: scout.ms, usd: scout.usd, ...(scout.fallback ? { fallback: scout.fallback } : {}) };
      a.handlers.onEvent?.(ev);
      a.handlers.onScout?.(ev);
      // Stage 2: the chosen pages' listings and images, then the streamed script.
      const { context, grounds } = await b.build(a.page, a.question, a.ink(), { pages: scout.pages, plan: scout.plan });
      if (signal.aborted) return;
      a.onGrounding(groundingOf(grounds));
      yield* askStream({ question: a.question, history: hist, context, ...(phase ? { phase } : {}) }, signal, a.handlers);
    } finally {
      inFlight.current--;
    }
  }, [history, doc, name]);

  const blocked = useMemo(() => (spendBlocked(spend) ? capLine(spend) : undefined), [spend]);

  /** The grounding of `pages` (eval replays: the pages the recorded answer was given). */
  const grounds = useCallback(async (page: number, pages: number[] = []): Promise<PageGround[]> => {
    const b = builder.current;
    return b ? (await b.build(page, '', [], { pages, plan: '' })).grounds : [];
  }, []);

  return { spend, blocked, refreshSpend, pageChanged, intent, source, history, grounds };
}
