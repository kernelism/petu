// src/App.tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { overviewHub } from './pdf/overview';
import './styles/tokens.css';
import './app.css';
import { loadPdf, type PdfDoc } from './pdf/loadPdf';
import { PdfViewer } from './pdf/PdfViewer';
import type { ViewerApi } from './pdf/viewerApi';
import { Director, type ActionTiming, type Journey } from './playback/director';
import { AnswerSession, type ParsedScript, type SessionState } from './playback/session';
import { deriveParts, nextSentence, partAt, partProgress, partText, partTitle, replayTarget, returnTarget, type Part } from './playback/parts';
import { SectionLabels } from './pdf/sections';
import { RouteChip, type Route } from './ui/RouteChip';
import type { PartsView } from './ui/PartsBar';
import { barMode, closingQuestion } from './ui/barMode';
import { answerHead, asideHead, clockOf, trailTitle, type TrailHead } from './ui/trail';
import { aboutContext, asideContext, bboxOf, isLoop, pointedLabel, type Pointed } from './agent/moment';
import { playbackKey, type PlaybackHandlers } from './ui/playbackKeys';
import { PacedClock, type NarrationClock } from './playback/clock';
import { VoiceClock, fetchVoice, warmVoice, webAudioOut } from './playback/voiceClock';
import { SwitchClock } from './playback/switchClock';
import { BASE_WPM, getSettings, setSettings, SPEEDS, stepSpeed, useSettings, type VoiceSetting } from './settings/settings';
import { DEMOS, DEMO_SIDE_QUESTION, DEMO_PLANE_QUESTION, DEMO_QUESTION, pickDemo, streamDemo } from './demo/demoScript';
import { SCRIPTS } from './demo/scripts';
import type { DevStep } from './demo/learner';
import { Desk, GLIDE_MS } from './desk/Desk';
import type { DeskState } from './desk/types';
import './desk/desk.css';
import { StudentInkLayer } from './ink/student/StudentInkLayer';
import { ink, PEN_COLORS, useInk } from './ink/student/store';
import { EmptyState } from './ui/EmptyState';
import { TopBar } from './ui/TopBar';
import { isShortcutsKey, ShortcutsOverlay } from './ui/ShortcutsOverlay';
import { boardZoomKey, isMacPlatform } from './ui/zoomKeys';
import { SettingsPopover } from './ui/SettingsPopover';
import { CanvasToolbar } from './ui/CanvasToolbar';
import { BoardPen } from './ui/BoardPen';
import { Caption, joinWords } from './ui/Caption';
import { AskBar, type Transcript } from './ui/AskBar';
import { heardSentences, sentenceAt, type LiveTranscript } from './ui/transcriptLive';
import { dictationAvailable } from './agent/dictation';
import { FollowPill } from './ui/FollowPill';
import { OverviewPill } from './ui/OverviewPill';
import { SessionDrawer, type SessionRow } from './ui/SessionDrawer';
import { dockPlacement, dockReserve, windowColumn } from './ui/layout';
import { DOCK_GAP, margin, SAFE_TOP, setSafeBottom } from './desk/layout';
import { takeSentences } from './ui/text';
import { pauseCueIn } from './ui/captionWindow';
import type { Action, RawAction } from './script/types';
import type { Grounding } from './geometry/resolve';
import type { AskEvent } from './agent/protocol';
import { AskError, askErrorLine, capLine, capNotice, spendPhase, type AskHandlers } from './agent/client';
import { fakeRepair, makeRepair, recordedRepair } from './agent/repair';
import { useAgent, type MakeContext } from './agent/useAgent';
import { ContextBuilder, groundPage } from './agent/context/build';
import { installEvalHooks, outOfFrameOf, publishGate, type EvalBackend, type Recorder, type RegistryRow } from './agent/evalHooks';
import type { Registry } from './desk/registry';
import { groundingOf, type PageGround } from './agent/context/types';
import { AnswerLog, boardOf, buildReport } from './report/capture';
import { LiveGate, GatePreflight, HEADROOM_MS, HEADROOM_OPUS_MS } from './gate/live';
import { budgetOf } from './agent/pacing';
import { ShadowStage } from './gate/shadow';
import { parseFaults } from './gate/faults';
import type { GateEvent, GateLogEvent, GateSetting, RepairFn } from './gate/events';
import { screenshot } from './report/screenshot';

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
// Dev-only: ?fail=<n> cuts the answer stream after n chunks, as a dropped connection does (none: an
// error; some: a cut-off, what arrived plays). ?failat=<c> cuts it after c characters (the demo's
// chunking is random; this is the same cut every run).
const FAIL_AFTER = import.meta.env.DEV && params.has('fail') ? Number(params.get('fail')) || 0 : null;
const FAIL_AT = import.meta.env.DEV && params.has('failat') ? Number(params.get('failat')) || 0 : null;
/** Demos, dev scripts and ?fail play canned scripts; every other question goes to the agent (POST /api/ask). */
const DEMO_PATH = !!DEV_SCRIPT || demoParam != null || FAIL_AFTER != null || FAIL_AT != null;
/** Dev-only: ?eval installs window.__petu for the eval runner (src/agent/evalHooks.ts). */
const EVAL = import.meta.env.DEV && params.has('eval');
/**
 * The scout's context (src/agent/context/tiers.ts): by default the tiered context for documents over
 * 60 pages (NEW_CTX_MIN_PAGES) and the digest below; ?ctx=old or ?ctx=new forces one for every document.
 */
const CTX = params.get('ctx') === 'new' ? 'new' : params.get('ctx') === 'old' ? 'old' : 'auto';
/** One context builder per opened document (src/agent/context/build.ts). */
const MAKE_CONTEXT: MakeContext = (doc, name) => new ContextBuilder(doc, name, { ctx: CTX });
const SAMPLE_URL = '/fixtures/epipolar.pdf';
const SAMPLE_NAME = 'Stereo Vision — sample.pdf';
const CAPTION_LINGER_MS = 2200;
/** An answer that drew nothing (an off-topic reply, a short note): the caption is all there is, so it stays longer. */
const CAPTION_LINGER_TEXT_MS = 6500;
/** The cap line hands over to the ask bar, which keeps it. */
const CAP_CAPTION_MS = 6000;
const ANSWER_FAILED = "The tutor didn't answer. Retry, or edit your question below.";
const NO_ANSWER = 'No answer came back.';
/** A journey's route stays up this long after it starts (the travel, the arrival beat, a read). */
const ROUTE_MS = 4000;
let audioCtx: AudioContext | null = null;
/**
 * The narration's clock: BASE_WPM, played at the playback speed (read on every word).
 * With a voice on, the voice's audio sets the timeline (src/playback/voiceClock.ts). Called from the
 * question's Enter (a user gesture), so the audio context may start.
 */
const narrationClock = (): SwitchClock => new SwitchClock(clockFor(getSettings().voice));
/** The clock for one voice setting (a SwitchClock hands the timeline over when the student changes it mid-answer). */
const clockFor = (voice: VoiceSetting) => (): NarrationClock => {
  if (voice === 'off' || typeof AudioContext === 'undefined') return new PacedClock(() => BASE_WPM, undefined, undefined, () => getSettings().speed);
  audioCtx ??= new AudioContext();
  void audioCtx.resume().catch(() => {});
  warmVoice();
  return new VoiceClock(fetchVoice(voice), webAudioOut(audioCtx), () => BASE_WPM, () => getSettings().speed);
};
/** ← within this many words of a part's start goes to the part before; later, to its own start. */
const PART_RESTART_WORDS = 8;
/** Demos and dev scripts send no page marks: every `mark=` is skipped. */
const NO_MARKS: Grounding = { mark: () => undefined };

/** The grounding of the pages a dev script names (p=N, pN:), when it points with page marks. */
async function devGrounding(doc: PdfDoc, script: string): Promise<Grounding> {
  if (!/mark=#|:#|on=#c|annotate=#|\{\{lift /.test(script)) return NO_MARKS;
  const pages = [...new Set([...script.matchAll(/\bp=?(\d+)\b/g)].map((m) => Number(m[1])))].filter((p) => p >= 1 && p <= doc.numPages);
  const OPS = (await import('pdfjs-dist')).OPS as unknown as Record<string, number>;
  return groundingOf(await Promise.all(pages.map(async (p) => groundPage(await doc.getPage(p), OPS))));
}

/** A URL's file name for the top bar; a malformed escape falls back to the raw text. */
function fileNameOf(src: string): string {
  const raw = src.split(/[?#]/)[0].split('/').pop() || 'document.pdf';
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Dev-only review aid: ?style=live|hand|clean picks the drawing style for this page load (never stored).
const styleParam = import.meta.env.DEV ? params.get('style') : null;
if (styleParam === 'live' || styleParam === 'hand' || styleParam === 'clean') setSettings({ inkStyle: styleParam });

// The live commit gate (src/gate/live.ts): &gate=off|shadow|live|audit (default live for agent answers,
// audit for dev scripts), &gatefail=K[:mode] (injected faults), &repair=fake|off, &repairms= (the fake's delay).
const GATE_PARAM = ((p) => (p === 'off' || p === 'shadow' || p === 'live' || p === 'audit' ? p : null))(params.get('gate')) as GateSetting | null;
const GATE_FAULTS = parseFaults(params.get('gatefail'));
/** `&gatelog`: every gate and repair event to the console. */
const GATE_LOG = params.has('gatelog');
const GATE_CHECK_ALL = params.get('gatecheck') === 'all';
const REPAIR_PARAM = params.get('repair');
/** `&budget=off`: no length budget (the gate never closes an answer early; A/B replays). */
const BUDGET_OFF = params.get('budget') === 'off';
const REPAIR_MS = Number(params.get('repairms')) || 1500;
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
  /** The lesson design (or why there was none): latency from the ask request, cost, the JSON. */
  storyboard?: Extract<AskEvent, { t: 'storyboard' }>;
  /** Stage 2's first text reached the player (absolute ms), and when the opener's words were due to end then. */
  handoff?: number; openerEnd?: number;
  /** The live gate's verdicts and repairs. */
  gate?: GateLogEvent[];
};

/** ?debug gate row: units, fails, strips, repairs, drops. */
function gateSummary(es: GateLogEvent[]): string {
  const g = es.filter((e): e is GateEvent => e.t === 'gate');
  const n = (f: (e: GateEvent) => boolean) => g.filter(f).length;
  const units = new Set(g.map((e) => e.k)).size;
  const reps = es.filter((e) => e.t === 'repair' && e.phase === 'sent').length;
  return `${units} units · ${n((e) => e.result === 'fail')} fail · ${n((e) => e.result === 'strip')} strip · ${reps} repair · ${n((e) => e.action === 'drop')} drop · ${g.length ? Math.max(...g.map((e) => e.ms)) : 0}ms max`;
}

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
  if (a.kind === 'sketch') return `sketch ${a.id}${a.page != null ? ` p${a.page}` : ''}${a.size === 'l' ? ' l' : ''}`;
  if (a.kind === 'connect') return 'connect';
  if ('ref' in a) return `${a.kind} #${a.ref}`;
  const cut = (t: string) => ` "${t.length > 18 ? `${t.slice(0, 17)}…` : t}"`;
  const q = 'quote' in a && a.quote ? cut(a.quote) : 'text' in a && a.text ? cut(a.text) : a.kind === 'math' ? cut(a.tex) : '';
  const where = a.kind === 'scroll' || a.page != null ? `p${a.page}` : a.region;
  return `${a.kind} ${where}${q}`;
}

/** Compact, bottom-left, collapsed by default so it never covers the page. Click to expand. */
function DebugPanel({ d, t0, cap }: { d: DebugState; t0: number; /** The spending cap's developer line (which cap, the knob), when asking is blocked. */ cap?: string }) {
  const [open, setOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [scoutOpen, setScoutOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  const done = d.done;
  const sb = d.storyboard;
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
      {cap && <div className="debug-row debug-note"><span>{cap}</span></div>}
      {sc && <div className="debug-row" title={sc.fallback}><span>scout</span><span>p{sc.pages.join(' → p')} · {sc.ms}ms{sc.fallback ? ' · fallback' : ''}</span></div>}
      {sc?.ctx && <div className="debug-row" title={sc.ctx.candidates.join('\n')}><span>context {sc.ctx.mode}</span><span>{sc.ctx.tier} · {Object.entries(sc.ctx.tokens).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ')} tok · {sc.ctx.ms}ms{sc.ctx.printedOffset ? ` · printed = PDF − ${sc.ctx.printedOffset}` : ''}</span></div>}
      {sc?.ctx?.candidates.length ? <div className="debug-row"><span>candidates</span><span>{sc.ctx.candidates.join(' · ')}</span></div> : null}
      {sc?.find?.length ? <div className="debug-row"><span>scout find</span><span>{sc.find.map((f) => `"${f}"`).join(' · ')}</span></div> : null}
      {sc?.atMs != null && <div className="debug-row"><span>scout verdict</span><span>{sc.atMs}ms{sc.input ? ` · cached ${Math.round((100 * (sc.cached ?? 0)) / sc.input)}%` : ''}</span></div>}
      {opener != null && <div className="debug-row"><span>opener</span><span>{ms(opener)}</span></div>}
      {d.gate?.length ? <div className="debug-row" title={d.gate.filter((e): e is GateEvent => e.t === 'gate' && e.action === 'drop').map((e) => `${e.k}: ${e.flags.map((f) => `${f.check}: ${f.detail}`).join('; ')}`).join('\n')}><span>gate</span><span>{gateSummary(d.gate)}</span></div> : null}
      {d.gate?.filter((e): e is GateEvent => e.t === 'gate' && e.action === 'drop').map((e, i) => <div key={`g${i}`} className="debug-row is-skipped" title={e.flags.map((f) => `${f.check}: ${f.detail}`).join('\n')}><span>dropped {e.k}</span><span><s>{(e.text ?? '').slice(0, 80)}</s></span></div>)}
      {d.handoff != null && <div className="debug-row"><span>stage 2 first text</span><span>{ms(d.handoff)}</span></div>}
      {gap != null && <div className="debug-row" title="+: silence between the opener's last word and stage 2's first; early: stage 2 was ready that long before the opener ended"><span>handoff gap</span><span>{gap >= 0 ? `+${gap}ms` : `0 (${-gap}ms early)`}</span></div>}
      {sc?.plan && (
        <button type="button" className="debug-plan" onClick={(e) => { e.stopPropagation(); setScoutOpen((o) => !o); }} aria-expanded={scoutOpen}>
          {scoutOpen ? <span className="debug-plan-text">{sc.plan}</span> : 'scout plan ▸'}
        </button>
      )}
      {sb && <div className="debug-row" title={sb.fallback}><span>storyboard</span><span>{sb.ms}ms · {money(sb.usd)}{sb.estimated ? ' est.' : ''}{sb.fallback ? ' · fallback' : ''}</span></div>}
      {sb?.board && (
        <button type="button" className="debug-plan" onClick={(e) => { e.stopPropagation(); setStoryOpen((o) => !o); }} aria-expanded={storyOpen}>
          {storyOpen ? <span className="debug-plan-text">{JSON.stringify(sb.board, null, 1)}</span> : `storyboard ${sb.model}/${sb.effort} · ${sb.board.beats.length} beats ▸`}
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
          <div className="debug-row"><span>$ stage 2</span><span>{money(done.usd)}{done.estimated ? ' est.' : ''}</span></div>
          <div className="debug-row" title="scout + storyboard + stage 2"><span>$ this answer</span><span>{money(done.usd + (sc?.usd ?? 0) + (sb?.usd ?? 0))}</span></div>
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
    for (const e of events) { if (e.t === 'meta') h.onMeta?.(e); else if (e.t === 'scout') h.onScout?.(e); else if (e.t === 'storyboard') h.onStoryboard?.(e); }
    // Stage 2 starts at the first chunk at or after the recorded handoff (the gate's opener ends there).
    const ho = events.find((e) => e.t === 'handoff');
    const s2 = ho?.t === 'handoff' ? chunks.findIndex((c) => c.t >= ho.ms - 1) : -1;
    for (const [i, c] of chunks.entries()) {
      const wait = c.t - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => window.setTimeout(r, wait));
      if (signal.aborted) return;
      if (i === s2 && ho?.t === 'handoff') h.onHandoff?.({ ...ho });
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

/** An aside's state in the dock: its question, words so far, and how it stands. */
type Aside = { question: string; words: string[]; state: 'thinking' | 'playing' | 'done' | 'error'; paused: boolean };
/** One answer on the session trail: its header on the board and what replays it. */
type TrailEntry = { num: string; question: string; title: string; page: number; script: string; grounding?: Grounding; head: TrailHead; check?: string; /** The check question it offered (done.check), offered again on a replay. */ offered?: string; /** Asides asked during it (the session drawer lists them under it). */ asides?: string[]; /** How long it played (ms), once done. */ ms?: number };
/** A dev script's aside when it has none of its own (no API call on the demo path). */
const asideFallback = (q: string) => `Here the side answer to "${q}" would play, with its own small drawing. Press Return to go back to the answer.`;

/** The desk as the aside's director sees it: it never aborts the desk, so the paused answer's moves stay valid. */
const asideDesks = new WeakMap<Desk, Desk>();
function asideDeskOf(d: Desk | null): Desk | null {
  if (!d) return null;
  let p = asideDesks.get(d);
  if (!p) {
    p = new Proxy(d, { get: (t, k) => (k === 'abort' ? () => {} : ((v) => (typeof v === 'function' ? v.bind(t) : v))(Reflect.get(t, k))) });
    asideDesks.set(d, p);
  }
  return p;
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
  /**
   * Flow across the document: the journey in progress; the page in view when the question was asked
   * (the "Back to pN" target, null once stopped) and the furthest part played (returnTarget).
   */
  const [route, setRoute] = useState<Route | null>(null);
  const routeTimer = useRef<number>();
  const [askedOn, setAskedOn] = useState<number | null>(null);
  const [reached, setReached] = useState(0);
  const originRef = useRef(1);
  /** The answer's parts (journeys split it), the part playing, and whether the student paused it. */
  const [parts, setParts] = useState<Part[]>([]);
  const partsRef = useRef<Part[]>([]);
  const scriptRef = useRef<ParsedScript | null>(null);
  const [partIdx, setPartIdx] = useState(0);
  const partIdxRef = useRef(0);
  partIdxRef.current = partIdx;
  const [userPaused, setUserPaused] = useState(false);
  /** Words spoken so far (the current part's progress). */
  const [spokenN, setSpokenN] = useState(0);
  const { speed } = useSettings();
  // The ask bar's mic shows only when the server has a Speechmatics key (GET /api/stt).
  const [dictationOn, setDictationOn] = useState(false);
  useEffect(() => { let live = true; void dictationAvailable().then((on) => { if (live) setDictationOn(on); }); return () => { live = false; }; }, []);
  /** The aside (one level): a question asked mid-answer, with its own session and ink lane; the answer waits paused. */
  const [aside, setAside] = useState<Aside | null>(null);
  const asideRef = useRef<Aside | null>(null);
  asideRef.current = aside;
  const asideSession = useRef<AnswerSession | null>(null);
  const asideGrounding = useRef<Grounding | undefined>();
  const asideDirRef = useRef<Director>();
  /** The answer was paused because the student started typing in the bar (it resumes if they clear it). */
  const typingPaused = useRef(false);
  /** The bar's moment (src/ui/barMode.ts): an answer has played; the last one closed on this question. */
  const [answered, setAnswered] = useState(false);
  /**
   * The answer's check question (p6.2: the model's hidden <check>, done.check; an older or tag-prompt
   * answer that closed on a spoken question offers that one). Offered as a collapsed "Test yourself"
   * chip; `checkOpen` once the student opens it: then it is pinned and the bar takes their answer.
   */
  const [check, setCheck] = useState<string | null>(null);
  const [checkOpen, setCheckOpen] = useState(false);
  const checkRef = useRef<string | null>(null);
  checkRef.current = checkOpen ? check : null;
  /** Dev learner steps open the check through this (they are defined before it). */
  const openCheckRef = useRef<() => void>(() => {});
  /** A new value focuses the ask bar (the check was opened). */
  const [barFocus, setBarFocus] = useState(0);
  /** The furthest word reached in the playing answer (a seek back keeps the transcript of what was heard). */
  const heardRef = useRef(0);
  /** Point-to-ask: what the next question is about (a selection, a circled region). */
  const [pointed, setPointed] = useState<Pointed | null>(null);
  const pointedRef = useRef<Pointed | null>(null);
  pointedRef.current = pointed;
  /** The current answer: its question, scout plan and whether it came from the agent (an aside's context). */
  const answerRef = useRef<{ question: string; plan: string; toAgent: boolean; head: TrailHead | null }>({ question: '', plan: '', toAgent: false, head: null });
  /** The session trail: every answer this session, with its recorded script (replayed with no new call). */
  const trailRef = useRef<TrailEntry[]>([]);
  const trailN = useRef(0);
  /** The clocks of the playing answer and aside, with their sessions (null once over): a voice change reaches them. */
  const clocks = useRef(new Map<SwitchClock, () => AnswerSession | null>());
  /** The shortcuts card (?). */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsOpenRef = useRef(false);
  shortcutsOpenRef.current = shortcutsOpen;
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const labelsRef = useRef<SectionLabels | null>(null);
  const [, setLabelTick] = useState(0);
  const journeyRef = useRef<(j: Journey) => void>(() => {});
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
  /** The eval recorder of the answer in flight. */
  const recRef = useRef<Recorder | null>(null);
  /** The current (or last) answer's record, for the Report button (src/report/capture.ts). */
  const logRef = useRef<AnswerLog | null>(null);

  /** Released scripts of the answers whose board is still up: the gate's shadow board starts from them. */
  const boardScripts = useRef<string[]>([]);
  const directorRef = useRef<Director>();
  if (!directorRef.current) {
    directorRef.current = new Director({
      viewer: () => viewerRef.current,
      desk: () => deskRef.current,
      grounding: () => groundingRef.current ?? NO_MARKS,
      settings: getSettings,
      onScrolledTo: () => setPageTick((n) => n + 1),
      onJourney: (j) => journeyRef.current(j),
      hold: (at, ms) => sessionRef.current?.hold(at, ms),
      spoken: (at) => sessionRef.current?.wordsBefore(at) ?? 0,
      beat: () => sessionRef.current?.beatWords() ?? [],
      onTiming: (t) => {
        logRef.current?.timing(t);
        recRef.current?.timing(t);
        if (DEBUG) setDebug((d) => {
          const log = d.log.filter((x) => x.firedAt !== t.firedAt || x.action !== t.action);
          const next = { ...d, action: d.action ?? t.firedAt, log: [...log, t] };
          window.__timings = next;
          return next;
        });
      },
    });
  }
  const director = directorRef.current;

  // Free the old document's worker resources when it is replaced or closed.
  useEffect(() => () => { void doc?.destroy(); }, [doc]);

  /** Ends the aside, if one is open: its session and ink stop, its inset collapses to its marker. */
  const endAside = () => {
    const sess = asideSession.current;
    asideSession.current = null;
    sess?.stop();
    asideDirRef.current?.stop();
    if (asideRef.current) deskRef.current?.setAside(false);
    asideRef.current = null;
    setAside(null);
    // The answer's header waited behind the aside's (no section yet): it goes back in line.
    const h = answerRef.current.head;
    if (h && !h.el.isConnected) deskRef.current?.headNext(h.el, h.h);
  };
  const clearHide = () => window.clearTimeout(hideTimer.current);
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

  // An answer that closed on a check question: once its narration has gone, the question stays pinned in
  // the caption while the bar asks for the student's answer (F01); a reply, a new question or Esc ends it.
  const pinCheck = !!check && checkOpen && !busy && !aside && !answerError && !captionVisible;
  /** The chip: the answer has a check question, not yet opened. */
  const offerCheck = !!check && !checkOpen && !busy && !aside && !answerError;
  const captionShown = captionVisible || pinCheck;
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
      const top = bar.getBoundingClientRect().top - (captionShown && cap ? cap.offsetHeight : 0);
      setViewBottom(Math.max(0, H - top + DOCK_GAP));
    };
    update();
    const ro = new ResizeObserver(update);
    dock.querySelectorAll('.askbar, .caption').forEach((e) => ro.observe(e));
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  }, [hasDoc, captionShown, stacked, boardY]);

  /** Shows a one-off line in the caption, then fades it. */
  const flash = useCallback((text: string, ms = 4000) => {
    clearHide();
    setQuestion(undefined);
    setWaiting(false);
    setAnswerError(null);
    setCaptionWords(text.split(' '));
    setCaptionVisible(true);
    hideTimer.current = window.setTimeout(() => setCaptionVisible(false), ms);
  }, []);
  const flashRef = useRef(flash);
  flashRef.current = flash;

  const stopAll = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    s?.stop();
    endAside();
    setUserPaused(false);
    director.stop();
    deskRef.current?.follow.setAnswering(false);
    clearPause();
    setWaiting(false);
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
    window.clearTimeout(routeTimer.current);
    setRoute(null);
    setAskedOn(null);
    setReached(0);
    setParts([]);
    partsRef.current = [];
    // An open check question belongs to the answer (and document) it closed; it never carries over.
    setCheck(null);
    setCheckOpen(false);
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
    /** The session trail: plays an earlier answer's recorded script again (no new call), under its number. */
    again?: TrailEntry;
    /** The last answer closed on this question; `q` is the student's reply (judged on the board). */
    check?: string;
  };

  /** Plays one answer. Resolves when it is done, stopped or failed. */
  const runAnswer = useCallback((q: string, run: Run = {}): Promise<void> => new Promise<void>((settle) => {
    const toAgent = (!DEMO_PATH || !!run.replay || !!run.rec) && !run.again;
    const t0 = performance.now();
    const old = sessionRef.current;
    sessionRef.current = null;
    old?.stop();
    clearHide();
    lastQuestion.current = q;
    recRef.current = run.rec ?? null;
    setTranscript(null);
    setAnswerError(null);
    // Flow: a new answer starts where the student is; its parts and route start over.
    endAside();
    typingPaused.current = false;
    setUserPaused(false);
    // The moment it is asked in: what the student pointed at, the check question it replies to.
    const point = run.again ? null : pointedRef.current;
    setPointed(null);
    setCheck(null);
    setCheckOpen(false);
    heardRef.current = 0;
    /** The model's hidden check question (done.check), offered once the answer ends. */
    let offered: string | undefined = run.again?.offered;
    const moment = { ...(point ? { about: aboutContext(point) } : {}), ...(run.check ? { check: run.check } : {}) };
    // The session trail: this answer's header goes above its first section on the board.
    // The header is always what the student typed: after a check question they may answer it or ask
    // something new, and only the model (which sees the open check question) can tell which.
    const kindCheck = run.again ? !!run.again.check : !!run.check;
    const title = run.again?.title ?? trailTitle('answer', q, point ? pointedLabel(point) : null);
    // A replay is the same entry played again in place: its header and drawings leave the board and come
    // back as it replays (one entry on the trail and in the session list; the numbering never moves).
    const entry: TrailEntry = run.again ?? { num: String(++trailN.current), question: q, title, page: pageRef.current, script: '', head: null as unknown as TrailHead, ...(kindCheck ? { check: run.check } : {}) };
    if (run.again) deskRef.current?.forget(entry.head.el);
    else entry.head = answerHead({ num: entry.num, question: title, check: false, onReplay: () => replayRef.current(entry) });
    // Eval runs keep the board as the judge has always seen it (no trail headers).
    if (!EVAL) deskRef.current?.headNext(entry.head.el, entry.head.h);
    answerRef.current = { question: q, plan: '', toAgent, head: EVAL ? null : entry.head };
    if (!run.rec && !run.replay && !run.again) trailRef.current.push(entry);
    /** What a replay plays: the recorded script as it was (a replay stopped halfway keeps it whole). */
    const again = run.again ? { script: run.again.script, grounding: run.again.grounding } : null;
    originRef.current = pageRef.current;
    window.clearTimeout(routeTimer.current);
    setRoute(null);
    setAskedOn(pageRef.current);
    setReached(0);
    setParts([]);
    partsRef.current = [];
    scriptRef.current = null;
    setPartIdx(0);
    setSpokenN(0);
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
    const log = new AnswerLog(q, page, toAgent ? 'agent' : 'script', t0);
    logRef.current = log;

    // The live commit gate: every unit is checked on the shadow board before it plays.
    // Dev scripts: off unless asked (&gate=audit): their audit still fails on shadow-fidelity gaps (scene
    // sections measured without a camera, kit blocks without the live board's centring) and on checks
    // written after the scripts. Agent answers: live.
    const setting: GateSetting = GATE_PARAM ?? (toAgent ? 'live' : 'off');
    let gate: LiveGate | null = null;
    let shadow: ShadowStage | null = null;
    const pageTexts = new Map<number, string>();
    const gateEvent = (e: GateLogEvent) => {
      // Gate events ride the answer's event log (recordings, Report); protocol.ts types them (Task B).
      log.event(e as never);
      run.rec?.event(e as never);
      if (DEBUG) setDebug((d) => ({ ...d, gate: [...(d.gate ?? []), e] }));
      publishGate(e); // __petu.gate() and the gallery's audit
      if (GATE_LOG) console.info('[gate]', JSON.stringify(e));
    };
    // Repairs: &repair=fake (no network) | off; replays use the recording's repairs; live answers ask the server.
    const repairFor = (): RepairFn | undefined => {
      if (REPAIR_PARAM === 'off') return undefined;
      if (REPAIR_PARAM === 'fake') return fakeRepair({ delayMs: REPAIR_MS, text: DEV_SCRIPT?.repairs });
      if (run.replay) return recordedRepair(run.replay.events ?? []);
      if (!toAgent) return undefined;
      const phase = spendPhase(ag.spend);
      return (req, signal) => (gate?.reqId ? makeRepair({ reqId: gate.reqId, ...(phase ? { phase } : {}) })(req, signal) : Promise.resolve({ ok: false, reason: 'refused', detail: 'no reqId' }));
    };
    if (setting !== 'off') {
      shadow = new ShadowStage({ desk: () => deskRef.current, viewer: () => viewerRef.current, settings: getSettings, grounding: () => groundingRef.current ?? NO_MARKS });
      if (boardScripts.current.length) void shadow.seed(boardScripts.current);
      // verdict.ts SEVERITY: `default` fails only skipped/unparsable actions, unbound numbers, erasure and
      // labelled references to nothing; &gatecheck=all is the design's table.
      const preflight = new GatePreflight({ board: shadow, pages: () => pageTexts, question: q, grounding: () => groundingRef.current, severity: GATE_CHECK_ALL ? 'design' : 'default',
        // The svg board's smallest text in its units: the board's body size at the board's scale (the renderer's rule).
        svgMinFont: () => { const m = deskRef.current?.metrics?.('wide'); return m && m.boardPx > 0 ? Math.max(12, m.bodyPx(null)) / (m.boardPx / 1000) : 16; } });
      gate = new LiveGate({
        clock: { now: () => performance.now(), endsAt: () => clock.endsAt() }, preflight,
        repair: repairFor(),
        faults: GATE_FAULTS, setting: setting === 'shadow' ? 'shadow' : 'live', onEvent: gateEvent,
        headroomMs: HEADROOM_MS,
      });
    }
    // Warm the pages the first units point at (the visible page; a dev script's own pages): the gate
    // vouches for page pointing from their text, so the first word never waits on loading them.
    if (gate) {
      const v = viewerRef.current;
      const want = new Set<number>([page, ...(!toAgent && DEV_SCRIPT ? [...DEV_SCRIPT.script.matchAll(/\bp=(\d+)/g)].map((m) => Number(m[1])) : [])]);
      if (v) for (const p of want) if (p >= 1 && p <= v.numPages()) void v.textRuns(p).then((rs) => { if (!pageTexts.has(p)) pageTexts.set(p, rs.map((r) => r.text).join(' ')); }).catch(() => {});
    }
    const handlers: AskHandlers = {
      onEvent: (e) => { log.event(e); run.rec?.event(e); },
      onMeta: (e) => {
        if (gate) { gate.setReq(e.reqId); if (/opus/i.test(e.model)) gate.setHeadroom(HEADROOM_OPUS_MS); }
        if (DEBUG) setDebug((d) => ({ ...d, meta: e }));
      },
      onScout: (e) => {
        // The length budget by the plan's scope (src/agent/pacing.ts): the gate closes the answer at a beat boundary past it.
        if (gate && !BUDGET_OFF) gate.setBudget(budgetOf(e.plan, e.opener));
        if (answerRef.current.question === q) answerRef.current.plan = e.plan ?? ''; if (DEBUG) setDebug((d) => ({ ...d, scout: e })); },
      onStoryboard: (e) => { if (DEBUG) setDebug((d) => ({ ...d, storyboard: e })); },
      onHandoff: (e) => {
        gate?.handoff();
        // When the words queued so far (the opener) end: past it, the student heard a gap.
        const end = clock.endsAt();
        const tNow = performance.now();
        if (spoke && Number.isFinite(end)) e.openerEndMs = Math.round(end - t0);
        if (DEBUG) setDebug((d) => ({ ...d, handoff: tNow, ...(spoke && Number.isFinite(end) ? { openerEnd: end } : {}) }));
      },
      onNote: (m) => { if (DEBUG) { console.info('[ask] note:', m); setDebug((d) => ({ ...d, notes: [...(d.notes ?? []), m] })); } },
      onDone: (e) => {
        if (DEBUG) setDebug((d) => ({ ...d, done: e }));
        if (e.check) { offered = e.check; entry.offered = e.check; }
        void agentRef.current.refreshSpend();
      },
      onCutOff: (m) => { cutOff = m; },
    };

    const clock = narrationClock();
    clocks.current.set(clock, () => (sessionRef.current === session ? session : null));
    /** The script stream has not ended: a pause in it is a gap the student can see. */
    let streamOpen = true;
    let firstChunk = true;
    let chunks = 0, sent = 0;
    const replay = run.replay;
    const inner: (signal: AbortSignal) => AsyncIterable<string> = replay
      ? async function* (signal) {
        // A replay resolves page marks against the same grounding the recorded question had.
        const sc = replay.events?.find((e) => e.t === 'scout');
        const gs = await ag.grounds(page, sc?.t === 'scout' ? sc.pages : []);
        for (const g of gs) pageTexts.set(g.page, g.lines.map((l) => l.text).join('\n'));
        groundingRef.current = groundingOf(gs);
        // A recording with no handoff had no opener: all of it is stage 2.
        if (!replay.events?.some((e) => e.t === 'handoff')) gate?.handoff();
        yield* replaySource(replay.chunks, replay.events ?? [], handlers)(signal);
      }
      : toAgent
        ? ag.source({
          question: q, page, ink: () => ink.get().strokes, handlers, onGrounding: (g) => { groundingRef.current = g; },
          onGrounds: (gs) => { for (const g of gs) pageTexts.set(g.page, g.lines.map((l) => l.text).join('\n')); },
          ...(gate ? { released: () => gate!.releasedText() } : {}),
          moment,
        })
        : run.again
          ? async function* (signal) {
            // The trail: the recorded script again, resolved against the grounding it had.
            gate?.handoff();
            groundingRef.current = again!.grounding;
            yield* streamDemo(signal, again!.script);
          }
          : async function* (signal) {
          gate?.handoff(); // dev scripts have no opener
          // checkpoint 1: demos play the closest script. A dev script that points with page marks
          // (?script=relational) resolves them against the pages' own grounding, as an answer would.
          // A dev script's later questions (a follow-up, a check reply) play their own canned scripts.
          const script = DEV_SCRIPT?.answers?.[q] ?? (DEV_SCRIPT ?? pickDemo(q)).script;
          if (DEV_SCRIPT && docRef.current) groundingRef.current = await devGrounding(docRef.current, script);
          yield* streamDemo(signal, script);
        };
    const source = async function* (signal: AbortSignal) {
      try {
        for await (const c of inner(signal)) {
          if (!toAgent && ((FAIL_AFTER != null && chunks >= FAIL_AFTER) || (FAIL_AT != null && sent + c.length > FAIL_AT))) {
            // As the agent's client does: nothing arrived yet is an error; past that, a cut-off (what played stays).
            const head = FAIL_AT != null ? c.slice(0, Math.max(0, FAIL_AT - sent)) : '';
            if (!sent && !head) throw new Error('dev: ?fail');
            if (head) { log.chunk(head); if (!again) entry.script += head; yield head; }
            handlers.onCutOff?.('The answer was cut off.');
            return;
          }
          chunks++;
          sent += c.length;
          if (firstChunk && DEBUG) { firstChunk = false; const t = performance.now(); setDebug((d) => ({ ...d, chunk: t })); }
          run.rec?.chunk(c);
          log.chunk(c);
          if (!again) entry.script += c;
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
      onScript: (sc) => {
        if (sessionRef.current !== session) return;
        scriptRef.current = sc;
        const ps = deriveParts(sc, page);
        const prev = partsRef.current;
        if (ps.length === prev.length && ps.every((p, i) => p.start === prev[i].start && p.page === prev[i].page && p.back === prev[i].back)) return;
        partsRef.current = ps;
        setParts(ps);
        const labels = labelsRef.current;
        // Titles only show in the stepper (two parts or more): a one-part answer reads no page text for them.
        if (ps.length > 1) for (const p of ps) if (labels && labels.get(p.page) == null) void labels.load(p.page).then((l) => { if (l) setLabelTick((n) => n + 1); });
      },
      onAction: (a, at, live) => {
        if (sessionRef.current !== session) return;
        if (a.kind !== 'scroll' && a.kind !== 'clear') drew = true;
        director.run(a, at, live);
      },
      idle: () => director.finale(),
      onWord: (words) => {
        if (sessionRef.current !== session) return;
        if (DEBUG && words.length === 1) { const t = performance.now(); setDebug((d) => ({ ...d, word: t })); }
        if (!spoke) { spoke = true; setWaiting(false); }
        const idx = partAt(partsRef.current, words.length - 1);
        setPartIdx(idx);
        setSpokenN(words.length);
        heardRef.current = Math.max(heardRef.current, words.length);
        setReached((r) => Math.max(r, idx));
        // The one wait cue: a faint ellipsis once these words are spoken and nothing new has come for 1.5 s.
        window.clearTimeout(pauseTimer.current);
        setPausing(false);
        pauseTimer.current = window.setTimeout(() => { if (sessionRef.current === session && streamOpen) setPausing(true); }, pauseCueIn(clock.endsAt(), clock.now()));
        run.rec?.word(words[words.length - 1]);
        log.words(words);
        spoken = words;
        speak(words);
        setCaptionWords(words);
      },
      onState: (st: SessionState, err?: string) => {
        log.state(st, err);
        if (st === 'stopped' && toAgent && spoken.length) ag.history.push(q, spoken, page);
        // A stopped answer that spoke counts as answered: the bar offers a follow-up (F20).
        if (st === 'stopped') { if (spoken.length) setAnswered(true); finish(); return; }
        if (sessionRef.current !== session) return;
        if (st === 'loading' || st === 'playing') { setBusy(true); return; }
        clearPause();
        setUserPaused(false);
        setBusy(false);
        setWaiting(false);
        deskRef.current?.follow.setAnswering(false);
        if (spoken.length) setTranscript({ question: q, answer: joinWords(spoken) });
        sessionRef.current = null;
        // The trail: where it was asked and how long it played; what replays it resolves as it did.
        entry.ms = performance.now() - t0;
        entry.head.setMeta(`p.${entry.page} · ${clockOf(entry.ms)}`);
        if (!again) entry.grounding = groundingRef.current;
        if (spoken.length) setAnswered(true);
        if (st === 'done') {
          // A check question to offer ("Test yourself", collapsed): the model's hidden one (p6.2), else
          // the spoken question an older or tag-prompt answer closed on.
          setCheck(cutOff == null ? offered ?? closingQuestion(joinWords(spoken)) : null);
          setCheckOpen(false);
          speak(spoken, true);
          if (toAgent && spoken.length) ag.history.push(q, spoken, page);
          if (cutOff != null || !spoken.length) {
            // Cut off (what arrived has played), or nothing came back: say so and offer Retry.
            clearHide();
            setCaptionWords([]);
            // A cut-off with its own reason (a spending cap) shows that reason; Retry wouldn't help.
            const why = cutOff != null && cutOff !== 'The answer was cut off.' ? cutOff : null;
            setAnswerError({ message: why ?? (cutOff != null ? askErrorLine('cut_off', null).message : NO_ANSWER), retry: why == null });
            setCaptionVisible(true);
            setLiveText(why ?? `${cutOff != null ? 'The answer was cut off.' : NO_ANSWER} Retry is available.`);
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
            setAnswerError({ message: capNotice(ag.spend), retry: false });
            if (import.meta.env.DEV) console.info('[spend]', capLine(ag.spend));
            void ag.refreshSpend().then((s) => { if (s) setAnswerError((cur) => (cur && !cur.retry ? { message: capNotice(s), retry: false } : cur)); });
            hideTimer.current = window.setTimeout(() => setCaptionVisible(false), CAP_CAPTION_MS);
            setLiveText(capNotice(ag.spend));
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
    const finishGate = () => {
      if (gate) { const t = gate.releasedText(); if (t.trim()) boardScripts.current.push(t); }
      shadow?.destroy();
      shadow = null;
    };
    void session.start(gate ? gate.wrap(source) : source).finally(finishGate);
  }), [director, flash]);

  /** The bar's Enter: mid-answer (or in an aside) an aside; after a check question, the reply; else a new answer. */
  const askAsideRef = useRef<(q: string) => void>(() => {});
  const onAsk = useCallback((q: string) => {
    if (asideRef.current || sessionRef.current) { askAsideRef.current(q); return; }
    const c = checkRef.current;
    void runAnswer(q, c ? { check: c } : {});
  }, [runAnswer]);
  /** The trail: a header clicked replays its answer from the recorded script (no new call). */
  const replayRef = useRef<(e: TrailEntry) => void>(() => {});

  const onStop = useCallback(() => {
    stopAll(); // the ink stays until the next answer starts
    clearHide();
    setCaptionVisible(false);
  }, [stopAll]);
  const closeRef = useRef(onStop);
  closeRef.current = onStop;

  // ---------------------------------------------------------------------------------------------
  // Flow across the document: journeys, parts, pause, go deeper

  /** A journey started (the director is about to travel): show the route. */
  journeyRef.current = (j: Journey) => {
    const back = j.to === originRef.current;
    const labels = labelsRef.current;
    setRoute({ from: j.from, to: j.to, label: labels?.get(j.to), back });
    if (labels && !back) void labels.load(j.to).then((label) => setRoute((r) => (r && r.to === j.to && label ? { ...r, label } : r)));
    window.clearTimeout(routeTimer.current);
    routeTimer.current = window.setTimeout(() => setRoute(null), ROUTE_MS);
  };

  const backTo = askedOn == null ? null : returnTarget(askedOn, page, reached);
  const onBack = useCallback(() => {
    const p = backTo;
    if (p == null) return;
    // Mid-answer this is the student taking the view (rule 6): the answer goes on, "Back to answer" shows.
    if (busyRef.current) deskRef.current?.follow.userTookOver();
    void viewerRef.current?.scrollToPage(p);
  }, [backTo]);

  const togglePause = useCallback(() => {
    // During an aside, Space pauses the aside (the answer under it stays paused).
    const a = asideSession.current;
    if (a && asideRef.current) {
      if (a.isPaused()) { if (a.resume()) setAside((d) => d && { ...d, paused: false }); }
      else if (a.pause()) setAside((d) => d && { ...d, paused: true });
      return;
    }
    const s = sessionRef.current;
    if (!s) return;
    typingPaused.current = false;
    if (s.isPaused()) { if (s.resume()) setUserPaused(false); return; }
    if (s.pause()) { setUserPaused(true); clearPause(); }
  }, []);

  /** Plays on from part i: forward fast-forwards the board, back repeats the narration (its ink stays) and returns to its page. */
  const jumpTo = useCallback((i: number) => {
    const s = sessionRef.current, p = partsRef.current[i];
    if (!s || !p || asideRef.current) return;
    const back = p.start < s.position();
    if (!s.seek(p.start)) return;
    setUserPaused(false);
    setPartIdx(i);
    setReached((r) => Math.max(r, i));
    deskRef.current?.follow.resume();
    if (back) director.run({ kind: 'scroll', page: p.page }, performance.now());
  }, [director]);

  const stepPart = useCallback((dir: -1 | 1) => {
    const s = sessionRef.current, ps = partsRef.current;
    if (!s || ps.length < 2 || asideRef.current) return;
    const pos = s.position();
    const i = partAt(ps, Math.max(0, pos - 1));
    if (dir > 0) { if (i + 1 < ps.length) jumpTo(i + 1); return; }
    jumpTo(pos - ps[i].start > PART_RESTART_WORDS || i === 0 ? i : i - 1);
  }, [jumpTo]);

  /** Seeks the narration to word `w` (replay a sentence, skip one): plays on from there. The aside's while one is open. */
  const seekWord = useCallback((w: number | null) => {
    const s = asideRef.current ? asideSession.current : sessionRef.current;
    if (!s || w == null) return;
    if (!s.seek(w)) return;
    if (asideRef.current) { setAside((d) => d && { ...d, paused: false }); return; }
    typingPaused.current = false;
    setUserPaused(false);
    clearPause();
    deskRef.current?.follow.resume();
  }, []);
  /** R (and Shift+←): the sentence being spoken again; pressed again at once, the one before. */
  const replaySentence = useCallback(() => {
    const s = asideRef.current ? asideSession.current : sessionRef.current;
    if (s) seekWord(replayTarget(s.script().words, s.position()));
  }, [seekWord]);
  /** Shift+→: on to the next sentence (once it has streamed in). */
  const skipSentence = useCallback(() => {
    const s = asideRef.current ? asideSession.current : sessionRef.current;
    if (s) seekWord(nextSentence(s.script().words, s.position()));
  }, [seekWord]);

  /** A new playback speed: remembered (settings), and the words not yet spoken re-time at once. */
  const changeSpeed = useCallback((next: number) => {
    if (next === getSettings().speed) return;
    setSettings({ speed: next });
    sessionRef.current?.respeed();
    asideSession.current?.respeed();
  }, []);
  /**
   * A new voice, applied to the playing answer and aside at once: Off stops the audio now and the reading
   * pace goes on from the current word; a voice takes over from the next sentence (SwitchClock).
   */
  const changeVoice = useCallback((v: VoiceSetting) => {
    if (v === getSettings().voice) return;
    setSettings({ voice: v });
    for (const [c, live] of clocks.current) {
      const s = live();
      if (!s) { clocks.current.delete(c); continue; }
      c.switchTo(clockFor(v), s.position(), v === 'off' ? 'now' : 'sentence');
      // 'now' re-times the next word through the scheduler's hand-off; a sentence switch needs none.
      if (v === 'off') s.respeed();
    }
  }, []);
  const cycleSpeed = useCallback(() => {
    const i = SPEEDS.findIndex((v) => v === getSettings().speed);
    changeSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
  }, [changeSpeed]);

  const titleOf = (p: Part) => partTitle(p, originRef.current, labelsRef.current?.get(p.page));

  /** The aside's own ink lane: a second director on the same desk (one that never aborts or resets it). */
  const asideDirector = () => {
    if (!asideDirRef.current) {
      asideDirRef.current = new Director({
        viewer: () => viewerRef.current,
        desk: () => asideDeskOf(deskRef.current),
        grounding: () => asideGrounding.current ?? NO_MARKS,
        settings: getSettings,
        onScrolledTo: () => setPageTick((n) => n + 1),
        hold: (at, ms) => asideSession.current?.hold(at, ms),
        spoken: (at) => asideSession.current?.wordsBefore(at) ?? 0,
        beat: () => asideSession.current?.beatWords() ?? [],
      });
    }
    return asideDirRef.current;
  };

  /**
   * An aside (v1 learner UX): a question asked while an answer plays. The answer pauses on its word;
   * the side answer plays with its own small drawing in a warm-grey inset on the board (the rest of
   * the board steps back); Return or "Back to answer" collapses the inset to a marker and the answer
   * goes on from the word it paused on. One level: asking again replaces the aside. Agent answers ask
   * /api/ask with the paused answer as context (`aside`); dev scripts play their canned `answers`.
   */
  const askAside = (q: string) => {
    const s = sessionRef.current;
    if (!s) return;
    if (!s.isPaused()) s.pause();
    typingPaused.current = false;
    setUserPaused(true);
    clearPause();
    endAside();
    const desk = deskRef.current;
    const head = asideHead({
      question: q,
      onBack: () => (asideRef.current ? closeAsideRef.current() : desk?.toggleAside(head.el)),
      onToggle: () => desk?.toggleAside(head.el),
    });
    desk?.setAside(true);
    desk?.headNext(head.el, head.h);
    const host = trailRef.current.find((e) => e.head === answerRef.current.head);
    if (host) (host.asides ??= []).push(q);
    const dir = asideDirector();
    dir.stop();
    dir.registry.clear();
    dir.figures.clear();
    asideGrounding.current = undefined;
    const point = pointedRef.current;
    setPointed(null);
    const next: Aside = { question: q, words: [], state: 'thinking', paused: false };
    asideRef.current = next;
    setAside(next);
    const cur = answerRef.current;
    const said = joinWords(s.script().words.slice(0, s.position()));
    const board = director.registry.entries().map((e) => `${e.kind}${e.id ? ` #${e.id}` : ''}${e.target.region ? ` on ${e.target.region}` : e.target.page ? ` on p${e.target.page}` : ''}`);
    const moment = { aside: asideContext({ question: cur.question, plan: cur.plan, said, board }), ...(point ? { about: aboutContext(point) } : {}) };
    const source: (signal: AbortSignal) => AsyncIterable<string> = cur.toAgent
      ? agentRef.current.source({ question: q, page: pageRef.current, ink: () => ink.get().strokes, handlers: {}, onGrounding: (g) => { asideGrounding.current = g; }, moment })
      : async function* (signal) {
        const script = DEV_SCRIPT?.answers?.[q] ?? asideFallback(q);
        if (DEV_SCRIPT && docRef.current) asideGrounding.current = await devGrounding(docRef.current, script);
        yield* streamDemo(signal, script);
      };
    const asideClock = narrationClock();
    clocks.current.set(asideClock, () => (asideSession.current === sess ? sess : null));
    const sess: AnswerSession = new AnswerSession({
      clock: asideClock,
      onParsed: (a) => dir.prefetch(a),
      onAction: (a, at, live) => { if (asideSession.current === sess) dir.run(a, at, live); },
      idle: () => dir.finale(),
      onWord: (words) => { if (asideSession.current === sess) setAside((d) => d && { ...d, words, state: 'playing' }); },
      onState: (st) => {
        if (asideSession.current !== sess) return;
        if (st === 'done') setAside((d) => d && { ...d, state: 'done' });
        else if (st === 'error') setAside((d) => d && { ...d, state: 'error' });
      },
    });
    asideSession.current = sess;
    void sess.start(source);
  };
  askAsideRef.current = askAside;

  /** Return / "Back to answer": the inset collapses to its marker and the answer goes on from its word. */
  const closeAside = useCallback(() => {
    if (!asideRef.current) return;
    endAside();
    if (sessionRef.current?.resume()) setUserPaused(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const closeAsideRef = useRef(closeAside);
  closeAsideRef.current = closeAside;

  /** Typing in the bar mid-answer pauses it (the question will be an aside); clearing the bar resumes it. */
  const onTyping = useCallback((typing: boolean) => {
    const s = sessionRef.current;
    if (!s || asideRef.current) return;
    if (typing && !s.isPaused() && s.pause()) { typingPaused.current = true; setUserPaused(true); clearPause(); }
    else if (!typing && typingPaused.current) { typingPaused.current = false; if (s.resume()) setUserPaused(false); }
  }, []);

  // Playback keys (src/ui/playbackKeys.ts): Space, R, ←/→, Shift+←/→, < >; Esc / Return close an aside.
  // Capture phase, so the keys never also scroll the slides (follow mode would read that as the
  // student taking over) or stop the answer (Esc).
  const keysRef = useRef<PlaybackHandlers>({ togglePause, stepPart, closeAside, replay: replaySentence, skip: skipSentence, speed: (d) => changeSpeed(stepSpeed(getSettings().speed, d)) });
  keysRef.current = { togglePause, stepPart, closeAside, replay: replaySentence, skip: skipSentence, speed: (d) => changeSpeed(stepSpeed(getSettings().speed, d)) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const handled = playbackKey(e, {
        aside: !!asideRef.current,
        playing: !!sessionRef.current,
        parts: partsRef.current.length,
        popover: !!document.querySelector('.popover'),
      }, keysRef.current);
      if (handled) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

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

  /**
   * Dev only: a simulated student (src/demo/learner.ts steps) after the first question of a dev
   * script: waits on the answer's words, the aside, or quiet, then asks, types, resumes, circles…
   */
  const playSteps = async (steps: DevStep[]) => {
    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const until = async (f: () => boolean) => { while (!f()) await sleep(100); };
    for (const st of steps) {
      if (st.words != null) await until(() => (sessionRef.current?.position() ?? 0) >= st.words!);
      if (st.asideDone != null) { await until(() => asideRef.current?.state === 'done'); await sleep(st.asideDone); }
      if (st.idle != null) { await until(() => !sessionRef.current && !asideRef.current); await sleep(st.idle); }
      if (st.ms != null) await sleep(st.ms);
      if (st.openCheck) openCheckRef.current();
      if (st.type != null || st.ask != null) {
        // Typed into the bar: mid-answer, the first character pauses the answer.
        const text = (st.type ?? st.ask)!;
        if (sessionRef.current && !asideRef.current) onTyping(true);
        setRestore((r) => ({ text, seq: (r?.seq ?? 0) + 1 }));
        if (st.ask != null) {
          await sleep(700);
          if (ink.get().canvasOn) ink.setCanvas(false); // the pen goes down to send
          setRestore((r) => ({ text: '', seq: (r?.seq ?? 0) + 1 }));
          onAsk(st.ask);
        }
      }
      if (st.resume) closeAsideRef.current();
      if (st.circle) {
        const v = viewerRef.current, c = st.circle;
        const H = v?.spaceHeight(c.page) || 1000;
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 40; i++) {
          const a = -Math.PI / 2 + (i / 40) * Math.PI * 2.08;
          pts.push([c.x + c.rx * Math.cos(a), ((c.y + c.ry * Math.sin(a)) * H) / 1000, 0.5]);
        }
        ink.setTool('pen');
        ink.add({ page: c.page, tool: 'pen', color: PEN_COLORS[0], points: pts });
      }
      if (st.zoom) { if (deskRef.current?.state().lane) viewerRef.current?.setOverview?.(st.zoom); else deskRef.current?.setZoom(st.zoom); }
      if (st.shortcuts) setShortcutsOpen(true);
    }
  };
  const playStepsRef = useRef(playSteps);
  playStepsRef.current = playSteps;

  replayRef.current = (e: TrailEntry) => {
    if (!e.script.trim()) return;
    stopAll();
    void runRef.current(e.question, { again: e });
  };

  // Point-to-ask: selecting text on a slide (or the board) attaches "about: …" to the bar.
  const clearPointed = useCallback(() => setPointed(null), []);
  useEffect(() => {
    if (!hasDoc) return;
    const onUp = () => window.setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text.length < 2) return;
      const n = sel.anchorNode;
      const el = n instanceof Element ? n : n?.parentElement;
      if (!el || el.closest('.dock, .popover, .toolbar, .topbar, .keys')) return;
      const pageEl = el.closest<HTMLElement>('[data-page]');
      if (pageEl) setPointed({ kind: 'selection', page: Number(pageEl.dataset.page), text: text.slice(0, 1200) });
      else if (el.closest('[data-petu-board]')) setPointed({ kind: 'selection', board: true, text: text.slice(0, 1200) });
    }, 0);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keyup', onUp);
    return () => { document.removeEventListener('mouseup', onUp); document.removeEventListener('keyup', onUp); };
  }, [hasDoc]);
  // …and circling something with the pen on a slide: the region, with the text inside it.
  const inkState = useInk();
  // …or circling part of the board: the drawn elements it covers, and the board text inside it.
  const onBoardWheel = useCallback((e: WheelEvent) => deskRef.current?.wheel(e), []);
  const onBoardLoop = useCallback((r: { x: number; y: number; w: number; h: number }) => {
    const d = deskRef.current;
    const inside = (b: { x: number; y: number; w: number; h: number } | null) => !!b && b.x + b.w / 2 >= r.x && b.x + b.w / 2 <= r.x + r.w && b.y + b.h / 2 >= r.y && b.y + b.h / 2 <= r.y + r.h;
    const elements = director.registry.entries()
      .filter((e) => e.target.region != null && inside(d?.onScreen(e.target.region, e.bbox) ?? null))
      .map((e) => `${e.kind}${e.id ? ` #${e.id}` : ''}`);
    const text = [...document.querySelectorAll<SVGTextElement>('[data-petu-board] .desk-region:not(.is-collapsed) text')]
      .filter((t) => { const b = t.getBoundingClientRect(); return inside({ x: b.x, y: b.y, w: b.width, h: b.height }); })
      .map((t) => t.textContent ?? '').join(' ');
    setPointed({ kind: 'circle', board: true, elements: elements.slice(0, 12), text });
  }, [director]);
  const lastStroke = useRef(0);
  useEffect(() => {
    const st = inkState.strokes[inkState.strokes.length - 1];
    if (!st || st.id <= lastStroke.current) return;
    lastStroke.current = st.id;
    const v = viewerRef.current;
    if (st.tool !== 'pen' || !v) return;
    const H = v.spaceHeight(st.page) || 1000;
    const pts = st.points.map(([x, y]) => ({ x, y: (y * 1000) / H }));
    if (!isLoop(pts)) return;
    const bbox = bboxOf(pts);
    const inside = (r: { x: number; y: number; w: number; h: number }) => {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      return cx >= bbox.x && cx <= bbox.x + bbox.w && cy >= bbox.y && cy <= bbox.y + bbox.h;
    };
    void v.textRuns(st.page).catch(() => []).then((runs) => {
      const text = runs.filter((r) => inside(r.rect)).map((r) => r.text).join(' ');
      setPointed({ kind: 'circle', page: st.page, bbox, text });
    });
  }, [inkState.strokes]);

  const onRetry = useCallback(() => {
    setRestore((r) => ({ text: '', seq: (r?.seq ?? 0) + 1 }));
    if (lastQuestion.current) onAsk(lastQuestion.current);
  }, [onAsk]);

  const onReady = useCallback((api: ViewerApi) => {
    viewerRef.current = api;
    // One desk per viewer (a new document remounts the viewer): the board, its sections, connectors.
    deskRef.current?.destroy();
    boardScripts.current = [];
    // The board's ×: an answer still playing stops first (its ink would have nowhere to go). Closing
    // hides the board and keeps the trail (the next drawing or a session-list pick brings it back).
    const desk = new Desk(api.deskHost(), stageRef.current!, { onClose: () => { if (busyRef.current) closeRef.current(); void deskRef.current?.hide(); } });
    deskRef.current = desk;
    desk.subscribe((s) => { setDesk(s); setPaused(desk.follow.paused()); });
    if (import.meta.env.DEV) { window.__viewer = api; window.__desk = desk; }
    setNumPages(api.numPages());
    const d = docRef.current;
    labelsRef.current = d ? new SectionLabels(d, (p) => api.textRuns(p), (p) => api.spaceHeight(p) / 1000) : null;
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
      // A dev script may be asked from a given page (?script=flow: p9).
      const at = DEV_SCRIPT?.page;
      const play = () => { autoplayTimer.current = window.setTimeout(() => { onAsk(autoplay); if (DEV_SCRIPT?.steps) void playStepsRef.current(DEV_SCRIPT.steps); }, 800); };
      if (at && at <= api.numPages()) void api.scrollToPage(at).then(() => { pageRef.current = at; play(); });
      else play();
    }
  }, [onAsk]);

  // Dev-only review autoplay: ?src= opens that PDF, ?demo= the sample deck (plays once, see onReady).
  useEffect(() => {
    if (DEV_SRC) void open(DEV_SRC, fileNameOf(DEV_SRC), false);
    else if (DEMO) void openSample();
  }, [open, openSample]);

  // ? opens the shortcuts card (it closes itself); ⌘− / ⌘+ / ⌘0 zoom the board (never the page).
  useEffect(() => {
    const mac = isMacPlatform();
    const onKey = (e: KeyboardEvent) => {
      if (!shortcutsOpenRef.current && isShortcutsKey(e)) { e.preventDefault(); setShortcutsOpen(true); return; }
      const z = boardZoomKey(e, { boardOpen: !!deskRef.current && deskRef.current.state().split !== 'none', mac });
      if (!z) return;
      e.preventDefault();
      if (z === 'fit') deskRef.current?.setZoom('fit'); else deskRef.current?.zoomStep(z === 'in' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Layout C: S opens the session list, M shows the earlier answers' page marks (spec §5.5).
  const [sessionOpen, setSessionOpen] = useState(false);
  const [pastOn, setPastOn] = useState(false);
  const [sessionPick, setSessionPick] = useState<number | null>(null);
  useEffect(() => { document.documentElement.classList.toggle('petu-past-on', pastOn); }, [pastOn]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || document.querySelector('.popover')) return;
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); setSessionOpen((o) => !o); }
      else if (k === 'm' && !e.shiftKey) {
        e.preventDefault();
        const on = !document.documentElement.classList.contains('petu-past-on');
        setPastOn(on);
        if (!busyRef.current) flashRef.current(on ? 'Past marks shown (M hides them)' : 'Past marks hidden', 1800);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const sessionRows: SessionRow[] = sessionOpen
    ? trailRef.current.map((e, i) => ({ num: e.num, title: e.title, meta: `p.${e.page}${e.ms != null ? ` · ${clockOf(e.ms)}` : ''}`, asides: e.asides ?? [], current: i === (sessionPick ?? trailRef.current.length - 1) }))
    : [];
  const sessionTotal = clockOf(trailRef.current.reduce((a, e) => a + (e.ms ?? 0), 0));
  const pickSession = useCallback((i: number) => {
    const e = trailRef.current[i];
    if (!e) return;
    setSessionPick(i);
    void deskRef.current?.showHead(e.head.el);
  }, []);

  // Esc between answers hides the board (while playing, Esc stops the answer first); it never erases:
  // the trail stays and comes back with the board. The lane stays (it is the sheet's margin).
  const boardOpen = !!desk && desk.split !== 'none' && !desk.lane;
  useEffect(() => {
    if (!boardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && !busyRef.current && !e.defaultPrevented && !typing && !document.querySelector('.popover')) void deskRef.current?.hide();
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

  /** × or Esc on the opened check: it is put away (the chip stays, to open again). */
  const dismissCheck = useCallback(() => setCheckOpen(false), []);
  /** The "Test yourself" chip: the question is pinned and the bar takes the student's answer. */
  const openCheck = useCallback(() => {
    clearHide();
    setCaptionVisible(false);
    setCheckOpen(true);
    setBarFocus((n) => n + 1);
  }, []);
  openCheckRef.current = openCheck;
  // Esc between answers clears a failed answer's line (F18); the question stays in the bar to edit or resend.
  useEffect(() => {
    if (!answerError) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busyRef.current || e.defaultPrevented || document.querySelector('.popover')) return;
      e.preventDefault();
      clearHide();
      setAnswerError(null);
      setCaptionVisible(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answerError]);
  const resumeFollow = useCallback(() => { void deskRef.current?.resume(); }, []);

  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  // Report (top bar flag, Shift+R): the state now, plus a PNG of the window; the note comes after.
  const captureReport = useCallback(async () => {
    const d = docRef.current;
    const dk = deskRef.current;
    const board = dk ? boardOf(dk.state(), director.registry.entries(), (id) => dk.region(id)) : null;
    const body = buildReport({
      note: '',
      doc: { name: fileName, hash: d?.fingerprints?.[0] ?? null, page: pageRef.current, numPages: d?.numPages ?? 0 },
      answer: logRef.current,
      board,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      search: location.search,
      path: location.pathname,
      settings: getSettings() as unknown as Record<string, unknown>,
    });
    let png: string | undefined;
    try { png = await screenshot(); } catch (e) { console.warn('[report] screenshot failed', e); }
    return async (note: string) => {
      const r = await fetch('/api/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report: { ...body, note: note.trim().slice(0, 2000) }, ...(png ? { png } : {}) }) });
      const j = await r.json().catch(() => null) as { dir?: string; error?: string } | null;
      if (!r.ok || !j?.dir) throw new Error(j?.error ?? `HTTP ${r.status}`);
      return j.dir;
    };
  }, [director, fileName]);

  // The overview zoom scales the sheet: the dock and its band follow the column where it shows, and keep
  // clear of the overview pill (bottom right) while it shows.
  const ovView = useSyncExternalStore(overviewHub.subscribe, overviewHub.getView, overviewHub.getView);
  const pillEl = typeof document !== 'undefined' ? document.querySelector('.overview-pill') : null;
  const pillReserve = ovView.z !== 1 ? (pillEl ? Math.max(0, viewportW - pillEl.getBoundingClientRect().left) : 260) + 12 : 0;
  const dock = dockPlacement(viewportW, desk, ovView, pillReserve);
  const dockCol = desk ? windowColumn(desk.column, viewportW, ovView) : null;
  /** The shortcuts card sits just above the dock (its top edge, from the window's bottom). */
  const dockBottom = dockRef.current ? Math.max(0, window.innerHeight - dockRef.current.getBoundingClientRect().top) : 96;
  // The playback row shows once an answer speaks (the question line holds its place until then).
  const curPart = Math.max(0, Math.min(partIdx, parts.length - 1));
  const partsView: PartsView | undefined = busy && !waiting
    ? {
      titles: parts.length > 1 ? parts.map(titleOf) : [],
      label: question,
      current: curPart,
      progress: partProgress(parts, curPart, spokenN, scriptRef.current?.words.length ?? spokenN),
      paused: aside ? aside.paused : userPaused,
      speed,
      onJump: jumpTo, onTogglePause: togglePause, onReplay: replaySentence, onSpeed: cycleSpeed, onStop,
      ...(aside ? { aside: { title: parts.length > 1 ? `Answer paused at ${curPart + 1}/${parts.length}` : 'Answer paused', onResume: closeAside } } : {}),
    }
    : undefined;
  const mode = barMode({ busy, aside: !!aside, answered, check: checkOpen ? check : null });
  // The transcript while the answer plays: the sentences heard so far, the one being spoken lit.
  const liveWords = busy && !aside ? scriptRef.current?.words : undefined;
  const liveSentences = liveWords && spokenN > 0 ? heardSentences(liveWords, heardRef.current) : null;
  const live: LiveTranscript | null = liveSentences?.length && question
    ? { question, sentences: liveSentences, current: sentenceAt(liveSentences, spokenN), onSeek: seekWord }
    : null;
  const about = pointed ? { label: pointedLabel(pointed), ...(pointed.page != null ? { page: pointed.page } : {}) } : null;

  if (!doc) return <EmptyState onFile={openFile} onSample={openSample} error={loadError} />;

  return (
    <>
      {/* Neighbouring pages step back only while an answer is drawing on the board and the student follows it.
          --view-top/--view-bottom: the viewer's visible band (under the chrome row, above the dock). */}
      <main
        className={`stage${desk?.sketching && desk.following && busy ? ' is-sketching' : ''}`}
        style={{
          '--glide': `${GLIDE_MS}ms`, '--view-top': `${SAFE_TOP}px`, '--view-bottom': `${viewBottom}px`,
          // Layout C: with the pen on the page, the page column ends its reading band above the dock (app.css).
          ...(desk?.lane && desk.page && Math.abs(desk.column.x - desk.page.x) < 1 ? { '--dock-col-x': `${dockCol!.x}px`, '--dock-col-w': `${dockCol!.w}px` } : {}),
        } as CSSProperties}
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
        report={import.meta.env.DEV ? captureReport : undefined}
        onGoToPage={(n) => void viewerRef.current?.goToPage(n, { reason: 'student' })}
      />
      <FollowPill visible={paused} onResume={resumeFollow} x={dock.x} />
      {desk?.edge && desk.page && (
        <button type="button" className={`lane-edge is-${desk.edge.dir}`} style={{ left: (() => { const c = windowColumn(desk.page!, viewportW, ovView); return Math.min(viewportW - 160, c.x + c.w + 24); })() }} onClick={() => void deskRef.current?.showEdge()}>
          <span aria-hidden="true">{desk.edge.dir === 'up' ? '↑' : '↓'}</span> p.{desk.edge.page} · marked
        </button>
      )}
      <OverviewPill />
      <SessionDrawer open={sessionOpen} rows={sessionRows} total={sessionTotal} onPick={pickSession} onClose={() => setSessionOpen(false)} />
      <RouteChip route={route} backTo={backTo} onBack={onBack} x={desk?.lane && desk.page ? desk.page.x + desk.page.w / 2 : dock.x} />
      <SettingsPopover open={settingsOpen} onClose={closeSettings} onShowShortcuts={openShortcuts} bestAvailable={!!agent.spend?.best} onSpeed={changeSpeed} onVoice={changeVoice} />
      <CanvasToolbar showHint={answered} />
      {inkState.canvasOn && inkState.tool === 'pen' && desk?.board && !desk.stacked && (
        <BoardPen rect={desk.board} color={inkState.color} keep={!!pointed && pointed.kind === 'circle' && pointed.page == null} onLoop={onBoardLoop} onWheel={onBoardWheel} />
      )}
      <ShortcutsOverlay open={shortcutsOpen} onClose={closeShortcuts} x={dock.x} bottom={dockBottom} dev={import.meta.env.DEV} />
      {/* left/width are set directly rather than through custom properties, so the dock's glide never
          depends on var() invalidation (suspected in a Safari report of the dock staying left; not
          reproduced in Playwright WebKit). */}
      <div ref={dockRef} className="dock" style={{ left: `${dock.x}px`, width: `${dock.w}px`, '--glide': `${GLIDE_MS}ms` } as CSSProperties}>
        <Caption
          words={aside ? aside.words : captionWords}
          visible={captionVisible || !!aside}
          question={aside ? aside.question : question}
          waiting={aside ? aside.state === 'thinking' : waiting}
          hint={aside?.state === 'error' ? "That couldn't be answered. Press Return to go back to the answer." : undefined}
          pausing={!aside && pausing && !userPaused}
          parts={partsView}
          error={answerError ? { message: answerError.message, onRetry: answerError.retry ? onRetry : undefined } : undefined}
          check={pinCheck ? check ?? undefined : undefined}
          onDismissCheck={dismissCheck}
        />
        <AskBar
          onAsk={onAsk}
          onStop={onStop}
          busy={busy}
          mode={mode}
          showStop={busy && !partsView}
          about={about}
          onClearAbout={clearPointed}
          onTyping={onTyping}
          onResume={closeAside}
          onDismissCheck={dismissCheck}
          onTestYourself={offerCheck ? openCheck : undefined}
          focusSeq={barFocus}
          suggestions={(isSample || DEV_SCRIPT) && !captionVisible && !answered ? SUGGESTIONS : undefined}
          restore={restore}
          transcript={transcript}
          live={live}
          blocked={DEMO_PATH ? undefined : agent.blocked}
          onIntent={onIntent}
          dictation={dictationOn}
        />
      </div>
      <div className="sr-only" role="status" aria-live="polite">{liveText}</div>
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
      {DEBUG && <DebugPanel d={debug} t0={askT0} cap={agent.blockedDetail} />}
    </>
  );
}
