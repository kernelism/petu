// src/App.tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import './styles/tokens.css';
import './app.css';
import { loadPdf, type PdfDoc } from './pdf/loadPdf';
import { PdfViewer } from './pdf/PdfViewer';
import type { ViewerApi } from './pdf/viewerApi';
import { Director, type ActionTiming } from './playback/director';
import { AnswerSession, type SessionState } from './playback/session';
import { PacedClock } from './playback/clock';
import { getSettings, setSettings } from './settings/settings';
import { DEMOS, DEMO_SIDE_QUESTION, DEMO_PLANE_QUESTION, DEMO_QUESTION, pickDemo, streamDemo } from './demo/demoScript';
import { SCRIPTS } from './demo/scripts';
import { Desk, GLIDE_MS } from './desk/Desk';
import type { DeskState } from './desk/types';
import './desk/desk.css';
import { StudentInkLayer } from './ink/student/StudentInkLayer';
import { ink, PEN_COLORS } from './ink/student/store';
import { EmptyState } from './ui/EmptyState';
import { TopBar } from './ui/TopBar';
import { SettingsPopover } from './ui/SettingsPopover';
import { CanvasToolbar } from './ui/CanvasToolbar';
import { Caption, joinWords } from './ui/Caption';
import { AskBar, type Transcript } from './ui/AskBar';
import { FollowPill } from './ui/FollowPill';
import { dockPlacement, dockReserve } from './ui/layout';
import { DOCK_GAP, margin, SAFE_TOP, setSafeBottom } from './desk/layout';
import { takeSentences } from './ui/text';
import type { Action, RawAction } from './script/types';
import type { Grounding } from './geometry/resolve';
import type { AskEvent } from './agent/protocol';
import { AskError, askErrorLine, capLine, type AskHandlers } from './agent/client';
import { useAgent, type MakeContext } from './agent/useAgent';
import { ContextBuilder, groundPage } from './agent/context/build';
import { installEvalHooks, outOfFrameOf, type EvalBackend, type Recorder, type RegistryRow } from './agent/evalHooks';
import type { Registry } from './desk/registry';
import { groundingOf, type PageGround } from './agent/context/types';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// Dev-only review autoplay: ?demo=1 the PDF demo, ?demo=side (or the old name, board) a sketch on the board, ?demo=plane a wide board.
const demoParam = import.meta.env.DEV ? params.get('demo') : null;
const DEMO = demoParam === '1' ? DEMO_QUESTION : demoParam === 'side' || demoParam === 'board' ? DEMO_SIDE_QUESTION : demoParam === 'plane' ? DEMO_PLANE_QUESTION : null;
// Dev-only: ?src=<pdf url>&script=<name> opens that PDF and plays a named script (src/demo/scripts.ts).
// ?script=<name> alone uses that script's own PDF.
const scriptParam = import.meta.env.DEV ? params.get('script') : null;
const DEV_SCRIPT = scriptParam ? SCRIPTS[scriptParam] ?? null : null;
const DEV_SRC = import.meta.env.DEV ? params.get('src') ?? DEV_SCRIPT?.src ?? null : null;
if (scriptParam && !DEV_SCRIPT) console.warn('[dev] unknown ?script=; known:', Object.keys(SCRIPTS).join(', '));
const SUGGESTIONS = DEV_SCRIPT ? [DEV_SCRIPT.question] : DEMOS.map((d) => d.question);
// Dev-only: ?fail=<n> makes the answer stream throw after n chunks (to review the error state).
const FAIL_AFTER = import.meta.env.DEV && params.has('fail') ? Number(params.get('fail')) || 0 : null;
/** Demos, dev scripts and ?fail play canned scripts; every other question goes to the agent (POST /api/ask). */
const DEMO_PATH = !!DEV_SCRIPT || demoParam != null || FAIL_AFTER != null;
/** Dev-only: ?eval installs window.__petu for the eval runner (src/agent/evalHooks.ts). */
const EVAL = import.meta.env.DEV && params.has('eval');
/** One context builder per opened document (src/agent/context/build.ts). */
const MAKE_CONTEXT: MakeContext = (doc, name) => new ContextBuilder(doc, name);
const SAMPLE_URL = '/fixtures/epipolar.pdf';
const SAMPLE_NAME = 'Stereo Vision — sample.pdf';
const CAPTION_LINGER_MS = 2200;
/** An answer that drew nothing (an off-topic reply, a short note): the caption is all there is, so it stays longer. */
const CAPTION_LINGER_TEXT_MS = 6500;
/** The cap line hands over to the ask bar, which keeps it. */
const CAP_CAPTION_MS = 6000;
const ANSWER_FAILED = 'Something went wrong.';
const NO_ANSWER = 'No answer came back.';
/** No word this long after Enter: one static line under the question. */
const STILL_THINKING_MS = 4000;
const STILL_THINKING = 'Still thinking…';
/** All words spoken and no new one for this long, mid-answer: the caption shows a faint ellipsis. */
const PAUSE_GRACE_MS = 350;
/** Demos and dev scripts send no page marks: every `mark=` is skipped. */
const NO_MARKS: Grounding = { mark: () => undefined };

/** The grounding of the pages a dev script names (p=N, pN:), when it points with page marks. */
async function devGrounding(doc: PdfDoc, script: string): Promise<Grounding> {
  if (!/mark=#|:#/.test(script)) return NO_MARKS;
  const pages = [...new Set([...script.matchAll(/\bp=?(\d+)\b/g)].map((m) => Number(m[1])))].filter((p) => p >= 1 && p <= doc.numPages);
  const OPS = (await import('pdfjs-dist')).OPS as unknown as Record<string, number>;
  return groundingOf(await Promise.all(pages.map(async (p) => groundPage(await doc.getPage(p), OPS))));
}

/** A URL's file name for the top bar; a malformed escape falls back to the raw text. */
function fileNameOf(src: string): string {
  const raw = src.split(/[?#]/)[0].split('/').pop() || 'document.pdf';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Dev-only review aid: ?style=live|hand|clean picks the drawing style.
const styleParam = import.meta.env.DEV ? params.get('style') : null;
if (styleParam === 'live' || styleParam === 'hand' || styleParam === 'clean') setSettings({ inkStyle: styleParam });

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

declare global {
  interface Window { __viewer?: ViewerApi; __desk?: Desk; __timings?: DebugState }
}

// ------------------------------------------------------------------------------------------------
// ?debug: latency from Enter, plus a rolling log of actions and how long each waited in the queue.

type DoneEvent = Extract<AskEvent, { t: 'done' }>;
type DebugState = {
  chunk?: number; word?: number; action?: number; log: ActionTiming[];
  /** Agent answers: the server's meta and done, and notes (dropped messages, lint). */
  meta?: Extract<AskEvent, { t: 'meta' }>; done?: DoneEvent; notes?: string[];
  /** Stage 1: the scout's pages (teaching order), plan, latency and cost. */
  scout?: Extract<AskEvent, { t: 'scout' }>;
  /** Stage 2's first text reached the player (absolute ms), and when the opener's words were due to end then. */
  handoff?: number; openerEnd?: number;
};

/** When the first ink of the answer started (the first drawing action, not layout). */
function firstInk(log: ActionTiming[]): number | undefined {
  let t: number | undefined;
  for (const x of log) {
    if (x.skipped || Number.isNaN(x.startedAt) || ['scroll', 'sketch', 'clear', 'let'].includes(x.action.kind)) continue;
    if (t == null || x.startedAt < t) t = x.startedAt;
  }
  return t;
}

const money = (n?: number) => (n == null ? '—' : n < 0.1 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

function describe(a: RawAction): string {
  if (a.kind === 'let') return `let ${a.defs.map(([n]) => n).join(' ')}`;
  if ('mark' in a) return `${a.kind} p${a.page} ${a.mark}`;
  if ('through' in a) return `${a.kind} ray`;
  return describeAction(a as Action);
}

function describeAction(a: Action): string {
  if (a.kind === 'clear') return a.kind;
  if (a.kind === 'sketch') return `sketch ${a.id} p${a.page}${a.size === 'l' ? ' l' : ''}`;
  if (a.kind === 'connect') return 'connect';
  if ('ref' in a) return `${a.kind} #${a.ref}`;
  const cut = (t: string) => ` "${t.length > 18 ? `${t.slice(0, 17)}…` : t}"`;
  const q = 'quote' in a ? cut(a.quote) : 'text' in a && a.text ? cut(a.text) : a.kind === 'math' ? cut(a.tex) : '';
  const where = a.kind === 'scroll' || a.page != null ? `p${a.page}` : a.region;
  return `${a.kind} ${where}${q}`;
}

/** Compact, bottom-left, collapsed by default so it never covers the page. Click to expand. */
function DebugPanel({ d, t0 }: { d: DebugState; t0: number }) {
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  const done = d.done;
  const sc = d.scout;
  const u = done?.usage;
  const cached = u && u.input_tokens > 0 ? `${Math.round((100 * (u.input_tokens_details?.cached_tokens ?? 0)) / u.input_tokens)}%` : '—';
  const notes = [...(done?.lint ?? []), ...(d.notes ?? [])];
  const ms = (t?: number) => (t == null ? '—' : `${Math.round(t - t0)}ms`);
  // The first chunk was the opener when stage 2's first text came later.
  const opener = d.chunk != null && d.handoff != null && d.handoff > d.chunk + 1 ? d.chunk : undefined;
  const gap = d.handoff != null && d.openerEnd != null && opener != null ? Math.round(d.handoff - d.openerEnd) : undefined;
  // Start relative to the word: layout that starts ahead of its word (anticipatory scrolls) is negative.
  const rel = (d: number) => { const r = Math.round(d); return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : '0'; };
  if (!open) {
    return (
      <button type="button" className="debug debug-pill" onClick={() => setOpen(true)} aria-label="Show timing details">
        first action {ms(d.action)} · {d.log.length} ▸
      </button>
    );
  }
  return (
    <div className="debug" onClick={() => setOpen(false)} title="Click to collapse">
      {sc && <div className="debug-row" title={sc.fallback}><span>scout</span><span>p{sc.pages.join(' → p')} · {sc.ms}ms{sc.fallback ? ' · fallback' : ''}</span></div>}
      {sc?.atMs != null && <div className="debug-row"><span>scout verdict</span><span>{sc.atMs}ms{sc.input ? ` · cached ${Math.round((100 * (sc.cached ?? 0)) / sc.input)}%` : ''}</span></div>}
      {opener != null && <div className="debug-row"><span>opener</span><span>{ms(opener)}</span></div>}
      {d.handoff != null && <div className="debug-row"><span>stage 2 first text</span><span>{ms(d.handoff)}</span></div>}
      {gap != null && <div className="debug-row" title="+: silence between the opener's last word and stage 2's first; early: stage 2 was ready that long before the opener ended"><span>handoff gap</span><span>{gap >= 0 ? `+${gap}ms` : `0 (${-gap}ms early)`}</span></div>}
      {sc?.plan && (
        <button type="button" className="debug-plan" onClick={(e) => { e.stopPropagation(); setScoutOpen((o) => !o); }} aria-expanded={scoutOpen}>
          {scoutOpen ? <span className="debug-plan-text">{sc.plan}</span> : 'scout plan ▸'}
        </button>
      )}
      {d.meta && <div className="debug-row"><span>model</span><span>{d.meta.model}/{d.meta.effort}</span></div>}
      {done && <div className="debug-row"><span>upstream TTFT</span><span>{done.ttftMs}ms</span></div>}
      <div className="debug-row"><span>first chunk</span><span>{ms(d.chunk)}</span></div>
      <div className="debug-row"><span>first word</span><span>{ms(d.word)}</span></div>
      <div className="debug-row"><span>first action</span><span>{ms(d.action)}</span></div>
      <div className="debug-row"><span>first ink</span><span>{ms(firstInk(d.log))}</span></div>
      {done && (
        <>
          <div className="debug-row"><span>$ this answer</span><span>{money(done.usd)}{done.estimated ? ' est.' : ''}</span></div>
          <div className="debug-row"><span>$ spent / cap</span><span>{money(done.spentUsd)} / {money(done.capUsd)}</span></div>
          <div className="debug-row"><span>cached</span><span>{cached}</span></div>
        </>
      )}
      {notes.map((n, i) => <div key={`n${i}`} className="debug-row debug-note"><span>{n}</span></div>)}
      {done?.plan && (
        <button type="button" className="debug-plan" onClick={(e) => { e.stopPropagation(); setPlanOpen((o) => !o); }} aria-expanded={planOpen}>
          {planOpen ? <span className="debug-plan-text">{done.plan}</span> : 'plan ▸'}
        </button>
      )}
      {d.log.length > 0 && (
        <div className="debug-head" title="at: word time from Enter · start: when it began, relative to its word (− = early) · run: duration">
          <span>action</span><span>at · start · run</span>
        </div>
      )}
      {d.log.slice(-8).map((t, i) => (
        <div key={i} className={`debug-row${t.skipped ? ' is-skipped' : ''}`} title={t.skipped}>
          <span className="debug-act">{describe(t.action)}</span>
          <span>
            {Math.round(t.firedAt - t0)} · {Number.isNaN(t.startedAt) ? '…' : rel(t.startedAt - t.firedAt)} · {t.endedAt == null ? '…' : t.skipped ? 'skip' : Math.round(t.endedAt - t.startedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Eval replay: recorded chunks at their recorded offsets from Enter; recorded events drive the same handlers. */
function replaySource(chunks: { t: number; d: string }[], events: AskEvent[], h: AskHandlers) {
  return async function* (signal: AbortSignal): AsyncGenerator<string> {
    const t0 = performance.now();
    for (const e of events) { if (e.t === 'meta') h.onMeta?.(e); else if (e.t === 'scout') h.onScout?.(e); }
    for (const c of chunks) {
      const wait = c.t - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
      if (signal.aborted) return;
      yield c.d;
    }
    for (const e of events) {
      if (e.t === 'done') h.onDone?.(e);
      else if (e.t === 'error') h.onCutOff?.(e.message);
    }
  };
}

/** Eval ink questions: the page's largest labelled mark, as a page-coord rect (0–1000 both axes). */
function largestLabelled(g: PageGround | undefined): { x: number; y: number; w: number; h: number } | null {
  let best: { x: number; y: number; w: number; h: number } | null = null, area = -1;
  // The largest labelled mark; on a page with no labelled marks (a lone figure image), the largest
  // mark of any kind, so an ink question always has ink (P1: lec09 p25 and lec08 p24 drew none).
  const marks = g?.marks ?? [];
  const pool = marks.some((m) => m.label) ? marks.filter((m) => m.label) : marks;
  for (const m of pool) {
    const r = m.kind === 'dot' ? { x: m.at.x - 15, y: m.at.y - 15, w: 30, h: 30 }
      : 'from' in m ? { x: Math.min(m.from.x, m.to.x), y: Math.min(m.from.y, m.to.y), w: Math.abs(m.to.x - m.from.x), h: Math.abs(m.to.y - m.from.y) }
      : m.rect;
    const a = Math.max(r.w, 1) * Math.max(r.h, 1);
    if (a > area) { area = a; best = r; }
  }
  return best;
}

/** The current answer's drawn elements, plain, for the eval metrics. */
function registryRows(reg: Registry): RegistryRow[] {
  return reg.entries().map((e) => ({ id: e.id, kind: e.kind, target: e.target, bbox: e.bbox, boxes: e.boxes, strokes: e.strokes ?? [] }));
}

// ------------------------------------------------------------------------------------------------

export default function App() {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const docRef = useRef<PdfDoc | null>(null);
  docRef.current = doc;
  const [fileName, setFileName] = useState('');
  const [isSample, setIsSample] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [captionWords, setCaptionWords] = useState<string[]>([]);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [pageTick, setPageTick] = useState(0);
  /** The desk's split state and slide column (the dock centres under it), and whether the student has taken over. */
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [paused, setPaused] = useState(false);
  const [viewportW, setViewportW] = useState(window.innerWidth);
  /** The asked question, echoed above the caption while answering. */
  const [question, setQuestion] = useState<string | undefined>();
  const [waiting, setWaiting] = useState(false);
  /** "Still thinking…" once no word has come for a while. */
  const [hint, setHint] = useState<string | undefined>();
  /** Mid-answer, all words so far spoken and the next not yet in (e.g. the opener ended before stage 2). */
  const [pausing, setPausing] = useState(false);
  const pauseTimer = useRef<number>();
  /** A failed or cut-off answer: its line, and whether Retry is offered. */
  const [answerError, setAnswerError] = useState<{ message: string; retry: boolean } | null>(null);
  const [restore, setRestore] = useState<{ text: string; seq: number } | undefined>();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  /** Whole sentences of narration for screen readers (polite live region). */
  const [liveText, setLiveText] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const [debug, setDebug] = useState<DebugState>({ log: [] });
  const [askT0, setAskT0] = useState(0);

  const viewerRef = useRef<ViewerApi | null>(null);
  const deskRef = useRef<Desk | null>(null);
  /** The board's host (and the connectors' overlay): the Desk owns its children. */
  const stageRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const sessionRef = useRef<AnswerSession | null>(null);
  const isSampleRef = useRef(false);
  isSampleRef.current = isSample;
  const hideTimer = useRef<number>();
  const autoplayTimer = useRef<number>();
  const lastQuestion = useRef('');
  const demoStarted = useRef(false);
  const loadSeq = useRef(0);

  const pageRef = useRef(1);
  /** The marks of the pages sent with the current question (agent answers only). */
  const groundingRef = useRef<Grounding | undefined>();
  const thinkTimer = useRef<number>();
  /** The eval recorder of the answer in flight. */
  const recRef = useRef<Recorder | null>(null);

  const directorRef = useRef<Director>();
  if (!directorRef.current) {
    directorRef.current = new Director({
      viewer: () => viewerRef.current,
      desk: () => deskRef.current,
      grounding: () => groundingRef.current ?? NO_MARKS,
      settings: getSettings,
      onScrolledTo: () => setPageTick((n) => n + 1),
      onTiming: DEBUG || EVAL
        ? (t) => {
            recRef.current?.timing(t);
            if (DEBUG) setDebug((d) => {
              const log = d.log.filter((x) => x.firedAt !== t.firedAt || x.action !== t.action);
              const next = { ...d, action: d.action ?? t.firedAt, log: [...log, t] };
              window.__timings = next;
              return next;
            });
          }
        : undefined,
    });
  }
  const director = directorRef.current;

  // Free the old document's worker resources when it is replaced or closed.
  useEffect(() => () => { void doc?.destroy(); }, [doc]);

  const clearHide = () => window.clearTimeout(hideTimer.current);
  const clearThink = () => { window.clearTimeout(thinkTimer.current); setHint(undefined); };
  const clearPause = () => { window.clearTimeout(pauseTimer.current); setPausing(false); };

  const agent = useAgent({ doc, name: fileName, enabled: !DEMO_PATH || EVAL, make: MAKE_CONTEXT, warmSystem: !params.has('nogen') });
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // The dock follows the window (and the desk's column, through its state).
  useEffect(() => {
    // --m (the window margin) from the same function the layout uses, so CSS and JS edges match to the pixel.
    const apply = () => { setViewportW(window.innerWidth); document.documentElement.style.setProperty('--m', `${margin(window.innerWidth)}px`); };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
  useEffect(() => () => { window.clearTimeout(autoplayTimer.current); deskRef.current?.destroy(); }, []);

  // Framing keeps pages and regions clear of the dock at its tallest (question + two narration
  // lines over the ask bar), measured from the live elements, so the caption never covers them.
  const dockRef = useRef<HTMLDivElement>(null);
  const hasDoc = doc != null;
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const measure = () => {
      const bar = dock.querySelector<HTMLElement>('.askbar'), cap = dock.querySelector<HTMLElement>('.caption');
      if (!bar || !cap) return;
      const cs = getComputedStyle(cap), ds = getComputedStyle(dock);
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
      setSafeBottom(dockReserve({
        bottom: parseFloat(ds.bottom) || 0,
        askbar: bar.offsetHeight,
        capPad: (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0),
        capLine: line,
      }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const bar = dock.querySelector('.askbar');
    if (bar) ro.observe(bar);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [hasDoc]);

  // The viewer's visible area ends above the dock (the caption when it shows, else the ask bar), or,
  // stacked, above the board: no slide content under the dock, no sliver of a page between its parts.
  const [viewBottom, setViewBottom] = useState(0);
  const stacked = !!desk?.stacked;
  const boardY = desk?.board?.y;
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const update = () => {
      const H = window.innerHeight;
      if (stacked && boardY != null) { setViewBottom(Math.max(0, H - (boardY - margin(window.innerWidth)))); return; }
      const bar = dock.querySelector<HTMLElement>('.askbar'), cap = dock.querySelector<HTMLElement>('.caption');
      if (!bar) return;
      const top = bar.getBoundingClientRect().top - (captionVisible && cap ? cap.offsetHeight : 0);
      setViewBottom(Math.max(0, H - top + DOCK_GAP));
    };
    update();
    const ro = new ResizeObserver(update);
    dock.querySelectorAll('.askbar, .caption').forEach((e) => ro.observe(e));
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [hasDoc, captionVisible, stacked, boardY]);

  /** Shows a one-off line in the caption, then fades it. */
  const flash = useCallback((text: string, ms = 4000) => {
    clearHide();
    setQuestion(undefined);
    setWaiting(false);
    clearThink();
    setAnswerError(null);
    setCaptionWords(text.split(' '));
    setCaptionVisible(true);
    hideTimer.current = window.setTimeout(() => setCaptionVisible(false), ms);
  }, []);

  const stopAll = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    s?.stop();
    director.stop();
    deskRef.current?.follow.setAnswering(false);
    clearPause();
    setWaiting(false);
    clearThink();
    setBusy(false);
  }, [director]);

  /** Wipes the answer UI, for a new document (its marks and regions go with the old viewer and desk). */
  const resetAnswerUi = useCallback(() => {
    window.clearTimeout(autoplayTimer.current);
    clearHide();
    setCaptionVisible(false);
    setCaptionWords([]);
    setQuestion(undefined);
    setAnswerError(null);
    setTranscript(null);
    setLiveText('');
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Documents

  const open = useCallback(async (src: ArrayBuffer | string, name: string, sample: boolean) => {
    const seq = ++loadSeq.current;
    try {
      const d = await loadPdf(src);
      if (seq !== loadSeq.current) { void d.destroy(); return; }
      stopAll();
      resetAnswerUi();
      ink.reset();
      viewerRef.current = null;
      setLoadError(undefined);
      setDoc(d);
      setFileName(name);
      setIsSample(sample);
      setNumPages(d.numPages);
      setPage(1);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      console.warn('[open]', e);
      setLoadError("Couldn't open that PDF.");
    }
  }, [stopAll, resetAnswerUi]);

  const openSample = useCallback(() => open(SAMPLE_URL, SAMPLE_NAME, true), [open]);
  const openFile = useCallback(async (f: File) => open(await f.arrayBuffer(), f.name, false), [open]);

  // A failed load while a document is open is reported in the caption (the drop zone isn't shown).
  useEffect(() => {
    if (doc && loadError) { flash(loadError, 3000); setLoadError(undefined); }
  }, [doc, loadError, flash]);

  // While a document is open, dropping a PDF anywhere replaces it (EmptyState handles the no-doc case).
  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;
  useEffect(() => {
    if (!doc) return;
    let depth = 0;
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const over = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer!.files[0];
      if (!f) return;
      if (!isPdf(f)) { flash("That doesn't look like a PDF.", 3000); return; }
      void openFileRef.current(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      setDragging(false);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [doc, flash]);

  // ---------------------------------------------------------------------------------------------
  // Answers

  type Run = {
    /** Eval: records chunks, events, words and sentences of this answer. */
    rec?: Recorder;
    /** Eval: plays recorded chunks (at their recorded offsets) instead of generating. */
    replay?: { chunks: { t: number; d: string }[]; events?: AskEvent[] };
  };

  /** Plays one answer. Resolves when it is done, stopped or failed. */
  const runAnswer = useCallback((q: string, run: Run = {}): Promise<void> => new Promise<void>((settle) => {
    const toAgent = !DEMO_PATH || !!run.replay || !!run.rec;
    const t0 = performance.now();
    const old = sessionRef.current;
    sessionRef.current = null;
    old?.stop();
    clearHide();
    clearThink();
    lastQuestion.current = q;
    recRef.current = run.rec ?? null;
    setTranscript(null);
    setAnswerError(null);
    // The old ink fades at the head of the director's queue while the request goes out.
    void director.begin(300);
    groundingRef.current = undefined;
    const ag = agentRef.current;
    if (toAgent && ag.blocked && !run.replay) { flash(ag.blocked, CAP_CAPTION_MS); settle(); return; }

    setCaptionWords([]);
    setQuestion(q);
    setWaiting(true);
    setCaptionVisible(true);
    setBusy(true);
    thinkTimer.current = window.setTimeout(() => setHint(STILL_THINKING), STILL_THINKING_MS);
    let spoken: string[] = [];
    let liveFrom = 0;
    const speak = (words: string[], final = false) => {
      const r = takeSentences(words, liveFrom, joinWords);
      liveFrom = r.from;
      const tail = final && liveFrom < words.length ? joinWords(words.slice(liveFrom)) : '';
      for (const sentence of r.sentences) run.rec?.sentenceEnd(sentence);
      if (tail) run.rec?.sentenceEnd(tail);
      const last = tail || r.sentences[r.sentences.length - 1];
      if (last) setLiveText(last);
    };
    if (DEBUG) { setAskT0(t0); setDebug({ log: [] }); }
    let spoke = false;
    let drew = false;
    let askErr: AskError | null = null;
    let cutOff: string | null = null;
    const page = pageRef.current;

    const handlers: AskHandlers = {
      onEvent: (e) => run.rec?.event(e),
      onMeta: (e) => { if (DEBUG) setDebug((d) => ({ ...d, meta: e })); },
      onScout: (e) => { if (DEBUG) setDebug((d) => ({ ...d, scout: e })); },
      onHandoff: (e) => {
        // When the words queued so far (the opener) end: past it, the student heard a gap.
        const end = clock.endsAt();
        const tNow = performance.now();
        if (spoke && Number.isFinite(end)) e.openerEndMs = Math.round(end - t0);
        if (DEBUG) setDebug((d) => ({ ...d, handoff: tNow, ...(spoke && Number.isFinite(end) ? { openerEnd: end } : {}) }));
      },
      onNote: (m) => { if (DEBUG) { console.info('[ask] note:', m); setDebug((d) => ({ ...d, notes: [...(d.notes ?? []), m] })); } },
      onDone: (e) => {
        if (DEBUG) setDebug((d) => ({ ...d, done: e }));
        void agentRef.current.refreshSpend();
      },
      onCutOff: (m) => { cutOff = m; },
    };

    const clock = new PacedClock(() => getSettings().wpm);
    /** The script stream has not ended: a pause in it is a gap the student can see. */
    let streamOpen = true;
    let firstChunk = true;
    let chunks = 0;
    const replay = run.replay;
    const inner: (signal: AbortSignal) => AsyncIterable<string> = replay
      ? async function* (signal) {
        // A replay resolves page marks against the same grounding the recorded question had.
        const sc = replay.events?.find((e) => e.t === 'scout');
        groundingRef.current = groundingOf(await ag.grounds(page, sc?.t === 'scout' ? sc.pages : []));
        yield* replaySource(replay.chunks, replay.events ?? [], handlers)(signal);
      }
      : toAgent
        ? ag.source({ question: q, page, ink: () => ink.get().strokes, handlers, onGrounding: (g) => { groundingRef.current = g; } })
        : async function* (signal) {
          // checkpoint 1: demos play the closest script. A dev script that points with page marks
          // (?script=relational) resolves them against the pages' own grounding, as an answer would.
          const script = (DEV_SCRIPT ?? pickDemo(q)).script;
          if (DEV_SCRIPT && docRef.current) groundingRef.current = await devGrounding(docRef.current, script);
          yield* streamDemo(signal, script);
        };
    const source = async function* (signal: AbortSignal) {
      try {
        for await (const c of inner(signal)) {
          if (!toAgent && FAIL_AFTER != null && chunks++ >= FAIL_AFTER) throw new Error('dev: ?fail');
          if (firstChunk && DEBUG) { firstChunk = false; const t = performance.now(); setDebug((d) => ({ ...d, chunk: t })); }
          run.rec?.chunk(c);
          yield c;
        }
      } catch (e) {
        if (e instanceof AskError) askErr = e;
        throw e;
      } finally {
        streamOpen = false;
      }
    };

    const finish = () => { if (recRef.current === run.rec) recRef.current = null; settle(); };
    const session: AnswerSession = new AnswerSession({
      clock,
      onParsed: (a) => director.prefetch(a),
      onAction: (a, at) => {
        if (sessionRef.current !== session) return;
        if (a.kind !== 'scroll' && a.kind !== 'clear') drew = true;
        director.run(a, at);
      },
      idle: () => director.idle(),
      onWord: (words) => {
        if (sessionRef.current !== session) return;
        if (DEBUG && words.length === 1) { const t = performance.now(); setDebug((d) => ({ ...d, word: t })); }
        if (!spoke) { spoke = true; setWaiting(false); clearThink(); }
        // Once these words are spoken, a faint ellipsis if nothing new has come (a gap in the stream).
        window.clearTimeout(pauseTimer.current);
        setPausing(false);
        pauseTimer.current = window.setTimeout(() => { if (sessionRef.current === session && streamOpen) setPausing(true); }, Math.max(0, clock.endsAt() - clock.now()) + PAUSE_GRACE_MS);
        run.rec?.word(words[words.length - 1]);
        spoken = words;
        speak(words);
        setCaptionWords(words);
      },
      onState: (st: SessionState, err?: string) => {
        if (st === 'stopped' && toAgent && spoken.length) ag.history.push(q, spoken, page);
        if (st === 'stopped') { finish(); return; }
        if (sessionRef.current !== session) return;
        if (st === 'loading' || st === 'playing') { setBusy(true); return; }
        clearPause();
        setBusy(false);
        setWaiting(false);
        clearThink();
        deskRef.current?.follow.setAnswering(false);
        if (spoken.length) setTranscript({ question: q, answer: joinWords(spoken) });
        sessionRef.current = null;
        if (st === 'done') {
          speak(spoken, true);
          if (toAgent && spoken.length) ag.history.push(q, spoken, page);
          if (cutOff != null || !spoken.length) {
            // Cut off (what arrived has played), or nothing came back: say so and offer Retry.
            clearHide();
            setCaptionWords([]);
            setAnswerError({ message: cutOff != null ? askErrorLine('cut_off', null).message : NO_ANSWER, retry: true });
            setCaptionVisible(true);
            setLiveText(`${cutOff != null ? 'The answer was cut off.' : NO_ANSWER} Retry is available.`);
          } else {
            hideTimer.current = window.setTimeout(() => setCaptionVisible(false), drew ? CAPTION_LINGER_MS : CAPTION_LINGER_TEXT_MS);
          }
        } else if (st === 'error') {
          console.warn('[answer]', err);
          clearHide();
          setCaptionWords([]);
          setCaptionVisible(true);
          const e = askErr as AskError | null;
          if (e?.code === 'cap') {
            // The ask bar takes over the cap line (it stays there); the caption says it once, then fades.
            setAnswerError({ message: capLine(ag.spend), retry: false });
            void ag.refreshSpend().then((s) => { if (s) setAnswerError((cur) => (cur && !cur.retry ? { message: capLine(s), retry: false } : cur)); });
            hideTimer.current = window.setTimeout(() => setCaptionVisible(false), CAP_CAPTION_MS);
            setLiveText(capLine(ag.spend));
          } else {
            const line = e ? askErrorLine(e.code, ag.spend) : { message: ANSWER_FAILED, retry: true };
            setAnswerError(line);
            // Keep the question: back in the ask bar to edit or resend.
            setRestore((r) => ({ text: q, seq: (r?.seq ?? 0) + 1 }));
            setLiveText(line.retry ? `${line.message} Retry is available.` : line.message);
          }
        }
        finish();
      },
    });
    sessionRef.current = session;
    void session.start(source);
  }), [director, flash]);

  const onAsk = useCallback((q: string) => { void runAnswer(q); }, [runAnswer]);

  const onStop = useCallback(() => {
    stopAll(); // the ink stays until the next answer starts
    clearHide();
    setCaptionVisible(false);
  }, [stopAll]);
  const closeRef = useRef(onStop);
  closeRef.current = onStop;

  // Dev-only: the eval runner's backend (window.__petu), over the real agent path.
  const evalReady = useRef<{ promise: Promise<void>; resolve(): void } | null>(null);
  if (EVAL && !evalReady.current) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    evalReady.current = { promise, resolve };
  }
  const runRef = useRef(runAnswer);
  runRef.current = runAnswer;
  useEffect(() => {
    if (!EVAL) return;
    const marks = new Map<number, PageGround | undefined>();
    const be: EvalBackend = {
      ready: async () => {
        await evalReady.current!.promise;
        // Grounds for the shown page (warm context; the ink question's largest mark).
        const p = pageRef.current;
        if (!marks.has(p)) marks.set(p, (await agentRef.current.grounds(p)).find((g) => g.page === p));
      },
      // &nogen: replays only; a generation request is refused here, before anything is sent.
      ask: (q, rec) => (params.has('nogen') ? Promise.reject(new Error('nogen: generation is off')) : runRef.current(q, { rec })),
      largestMark: (page) => largestLabelled(marks.get(page)),
      replay: (chunks, rec, events) => runRef.current(lastQuestion.current || 'replay', { rec, replay: { chunks, events } }),
      addInk: (page, pts) => {
        const H = viewerRef.current?.spaceHeight(page) ?? 1000;
        ink.add({ page, tool: 'pen', color: PEN_COLORS[0], points: pts.map((p) => [p.x, (p.y / 1000) * H, 0.5] as [number, number, number]) });
      },
      registry: () => registryRows(director.registry),
      outOfFrame: () => {
        const regions = new Set(registryRows(director.registry).flatMap((r) => (r.target.region != null ? [r.target.region] : [])));
        return outOfFrameOf(director.figures, regions);
      },
    };
    installEvalHooks(be);
  }, [director]);

  const onRetry = useCallback(() => {
    setRestore((r) => ({ text: '', seq: (r?.seq ?? 0) + 1 }));
    if (lastQuestion.current) onAsk(lastQuestion.current);
  }, [onAsk]);

  const onReady = useCallback((api: ViewerApi) => {
    viewerRef.current = api;
    // One desk per viewer (a new document remounts the viewer): the board, its sections, connectors.
    deskRef.current?.destroy();
    // The board's ×: an answer still playing stops first (its ink would have nowhere to go).
    const desk = new Desk(api.deskHost(), stageRef.current!, { onClose: () => { if (busyRef.current) closeRef.current(); void deskRef.current?.dismiss(); } });
    deskRef.current = desk;
    desk.subscribe((s) => { setDesk(s); setPaused(desk.follow.paused()); });
    if (import.meta.env.DEV) { window.__viewer = api; window.__desk = desk; }
    setNumPages(api.numPages());
    if (EVAL) {
      // ?page=N: show that page, let the context warm, then tell the runner.
      const p = Math.max(1, Math.min(api.numPages(), Number(params.get('page')) || 1));
      void api.scrollToPage(p).then(() => { pageRef.current = p; agentRef.current.pageChanged(p); return new Promise((r) => window.setTimeout(r, 1500)); })
        .then(() => evalReady.current?.resolve());
    }
    const autoplay = DEV_SCRIPT ? DEV_SCRIPT.question : DEMO && isSampleRef.current ? DEMO : null;
    if (autoplay && !demoStarted.current && !params.has('noplay')) {
      demoStarted.current = true;
      window.clearTimeout(autoplayTimer.current);
      autoplayTimer.current = window.setTimeout(() => onAsk(autoplay), 800);
    }
  }, [onAsk]);

  // Dev-only review autoplay: ?src= opens that PDF, ?demo= the sample deck (plays once, see onReady).
  useEffect(() => {
    if (DEV_SRC) void open(DEV_SRC, fileNameOf(DEV_SRC), false);
    else if (DEMO) void openSample();
  }, [open, openSample]);

  // Esc between answers closes the board (while playing, Esc stops the answer first).
  const boardOpen = !!desk && desk.split !== 'none';
  useEffect(() => {
    if (!boardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && !busyRef.current && !e.defaultPrevented && !typing && !document.querySelector('.popover')) void deskRef.current?.dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardOpen]);

  const onPageChange = useCallback((p: number) => {
    setPage(p);
    pageRef.current = p;
    agentRef.current.pageChanged(p);
  }, []);
  const onIntent = useCallback(() => { if (!DEMO_PATH) agentRef.current.intent(pageRef.current); }, []);

  const resumeFollow = useCallback(() => { void deskRef.current?.resume(); }, []);

  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const dock = dockPlacement(viewportW, desk);

  if (!doc) return <EmptyState onFile={openFile} onSample={openSample} error={loadError} />;

  return (
    <>
      {/* Neighbouring pages step back only while an answer is drawing on the board and the student follows it.
          --view-top/--view-bottom: the viewer's visible band (under the chrome row, above the dock). */}
      <main
        className={`stage${desk?.sketching && desk.following && busy ? ' is-sketching' : ''}`}
        style={{ '--glide': `${GLIDE_MS}ms`, '--view-top': `${SAFE_TOP}px`, '--view-bottom': `${viewBottom}px` } as CSSProperties}
      >
        <PdfViewer
          doc={doc}
          onReady={onReady}
          onPageChange={onPageChange}
          renderOverlay={(p, H) => <StudentInkLayer page={p} spaceH={H} />}
        />
      </main>
      {/* The board and the connectors' overlay (src/desk/Desk.ts fills it). Above the pages, below the chrome. */}
      <div ref={stageRef} className="desk-stage" />
      <TopBar
        fileName={fileName}
        page={page}
        numPages={numPages || doc.numPages}
        pageTick={pageTick}
        onOpenSettings={toggleSettings}
        onOpenFile={(f) => void openFile(f)}
      />
      <FollowPill visible={paused} onResume={resumeFollow} x={dock.x} />
      <SettingsPopover open={settingsOpen} onClose={closeSettings} />
      <CanvasToolbar />
      {/* left/width are set directly rather than through custom properties, so the dock's glide never
          depends on var() invalidation (suspected in a Safari report of the dock staying left; not
          reproduced in Playwright WebKit). */}
      <div ref={dockRef} className="dock" style={{ left: `${dock.x}px`, width: `${dock.w}px`, '--glide': `${GLIDE_MS}ms` } as CSSProperties}>
        <Caption
          words={captionWords}
          visible={captionVisible}
          question={question}
          waiting={waiting}
          hint={hint}
          pausing={pausing}
          error={answerError ? { message: answerError.message, onRetry: answerError.retry ? onRetry : undefined } : undefined}
        />
        <AskBar
          onAsk={onAsk}
          onStop={onStop}
          busy={busy}
          suggestions={(isSample || DEV_SCRIPT) && !captionVisible ? SUGGESTIONS : undefined}
          restore={restore}
          transcript={captionVisible ? null : transcript}
          blocked={DEMO_PATH ? undefined : agent.blocked}
          onIntent={onIntent}
        />
      </div>
      <div className="sr-only" role="status" aria-live="polite">{liveText}</div>
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
      {DEBUG && <DebugPanel d={debug} t0={askT0} />}
    </>
  );
}
