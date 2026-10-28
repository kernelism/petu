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
import { ink } from './ink/student/store';
import { EmptyState } from './ui/EmptyState';
import { TopBar } from './ui/TopBar';
import { SettingsPopover } from './ui/SettingsPopover';
import { CanvasToolbar } from './ui/CanvasToolbar';
import { Caption, joinWords } from './ui/Caption';
import { AskBar, type Transcript } from './ui/AskBar';
import { FollowPill } from './ui/FollowPill';
import { dockPlacement, dockReserve } from './ui/layout';
import { setSafeBottom } from './desk/layout';
import { takeSentences } from './ui/text';
import type { Action } from './script/types';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// Dev-only review autoplay: ?demo=1 the PDF demo, ?demo=side (or the old name, board) the desk sketch, ?demo=plane the stage.
const demoParam = import.meta.env.DEV ? params.get('demo') : null;
const DEMO = demoParam === '1' ? DEMO_QUESTION : demoParam === 'side' || demoParam === 'board' ? DEMO_SIDE_QUESTION : demoParam === 'plane' ? DEMO_PLANE_QUESTION : null;
// Dev-only: ?src=<pdf url>&script=<name> opens that PDF and plays a named script (src/demo/scripts.ts).
// ?script=<name> alone uses that script's own PDF.
const scriptParam = import.meta.env.DEV ? params.get('script') : null;
const DEV_SCRIPT = scriptParam ? SCRIPTS[scriptParam] ?? null : null;
const DEV_SRC = import.meta.env.DEV ? params.get('src') ?? DEV_SCRIPT?.src ?? null : null;
if (scriptParam && !DEV_SCRIPT) console.warn('[dev] unknown ?script=; known:', Object.keys(SCRIPTS).join(', '));
const SUGGESTIONS = DEV_SCRIPT ? [DEV_SCRIPT.question] : DEMOS.map((d) => d.question);
const SAMPLE_URL = '/fixtures/epipolar.pdf';
const SAMPLE_NAME = 'Stereo Vision — sample.pdf';
const CAPTION_LINGER_MS = 2200;
const NOT_SAMPLE = 'The agent connects in the next checkpoint; open the sample deck to see a demo.';
const ANSWER_FAILED = 'Something went wrong.';
// Dev-only: ?fail=<n> makes the answer stream throw after n chunks (to review the error state).
const FAIL_AFTER = import.meta.env.DEV && params.has('fail') ? Number(params.get('fail')) || 0 : null;

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

type DebugState = { chunk?: number; word?: number; action?: number; log: ActionTiming[] };

function describe(a: Action): string {
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
  const ms = (t?: number) => (t == null ? '—' : `${Math.round(t - t0)}ms`);
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
      <div className="debug-row"><span>first chunk</span><span>{ms(d.chunk)}</span></div>
      <div className="debug-row"><span>first word</span><span>{ms(d.word)}</span></div>
      <div className="debug-row"><span>first action</span><span>{ms(d.action)}</span></div>
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

// ------------------------------------------------------------------------------------------------

export default function App() {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [fileName, setFileName] = useState('');
  const [isSample, setIsSample] = useState(false);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [captionWords, setCaptionWords] = useState<string[]>([]);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [pageTick, setPageTick] = useState(0);
  /** The desk's mode and page column (the dock centers under it), and whether the student has taken over. */
  const [desk, setDesk] = useState<DeskState | null>(null);
  const [paused, setPaused] = useState(false);
  const [viewportW, setViewportW] = useState(window.innerWidth);
  /** The asked question, echoed above the caption while answering. */
  const [question, setQuestion] = useState<string | undefined>();
  const [waiting, setWaiting] = useState(false);
  const [answerError, setAnswerError] = useState(false);
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
  /** The B stage's host: the Desk owns its children. */
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

  const directorRef = useRef<Director>();
  if (!directorRef.current) {
    directorRef.current = new Director({
      viewer: () => viewerRef.current,
      desk: () => deskRef.current,
      settings: getSettings,
      onScrolledTo: () => setPageTick((n) => n + 1),
      onTiming: DEBUG
        ? (t) => setDebug((d) => {
            const log = d.log.filter((x) => x.firedAt !== t.firedAt || x.action !== t.action);
            const next = { ...d, action: d.action ?? t.firedAt, log: [...log, t] };
            window.__timings = next;
            return next;
          })
        : undefined,
    });
  }
  const director = directorRef.current;

  // Free the old document's worker resources when it is replaced or closed.
  useEffect(() => () => { void doc?.destroy(); }, [doc]);

  const clearHide = () => window.clearTimeout(hideTimer.current);

  // The dock follows the window (and the desk's column, through its state).
  useEffect(() => {
    const apply = () => setViewportW(window.innerWidth);
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

  /** Shows a one-off line in the caption, then fades it. */
  const flash = useCallback((text: string, ms = 4000) => {
    clearHide();
    setQuestion(undefined);
    setWaiting(false);
    setAnswerError(false);
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
    setAnswerError(false);
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

  const onAsk = useCallback((q: string) => {
    const demo = DEV_SCRIPT ?? pickDemo(q); // checkpoint 1: every question plays the closest demo
    const t0 = performance.now();
    const old = sessionRef.current;
    sessionRef.current = null;
    old?.stop();
    clearHide();
    lastQuestion.current = q;
    setTranscript(null);
    setAnswerError(false);
    // The old ink fades at the head of the director's queue while the request goes out.
    void director.begin(300);
    if (!isSampleRef.current && !DEV_SCRIPT) { setBusy(false); flash(NOT_SAMPLE); return; }

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
      const last = tail || r.sentences[r.sentences.length - 1];
      if (last) setLiveText(last);
    };
    if (DEBUG) { setAskT0(t0); setDebug({ log: [] }); }
    let spoke = false;

    let firstChunk = true;
    let chunks = 0;
    const source = async function* (signal: AbortSignal) {
      for await (const c of streamDemo(signal, demo.script)) {
        if (FAIL_AFTER != null && chunks++ >= FAIL_AFTER) throw new Error('dev: ?fail');
        if (firstChunk && DEBUG) { firstChunk = false; const t = performance.now(); setDebug((d) => ({ ...d, chunk: t })); }
        yield c;
      }
    };

    const session: AnswerSession = new AnswerSession({
      clock: new PacedClock(() => getSettings().wpm),
      onParsed: (a) => director.prefetch(a),
      onAction: (a, at) => { if (sessionRef.current === session) director.run(a, at); },
      idle: () => director.idle(),
      onWord: (words) => {
        if (sessionRef.current !== session) return;
        if (DEBUG && words.length === 1) { const t = performance.now(); setDebug((d) => ({ ...d, word: t })); }
        if (!spoke) { spoke = true; setWaiting(false); }
        spoken = words;
        speak(words);
        setCaptionWords(words);
      },
      onState: (st: SessionState, err?: string) => {
        if (sessionRef.current !== session) return;
        if (st === 'loading' || st === 'playing') { setBusy(true); return; }
        setBusy(false);
        setWaiting(false);
        deskRef.current?.follow.setAnswering(false);
        if (spoken.length) setTranscript({ question: q, answer: joinWords(spoken) });
        if (st === 'done') {
          sessionRef.current = null;
          speak(spoken, true);
          hideTimer.current = window.setTimeout(() => setCaptionVisible(false), CAPTION_LINGER_MS);
        } else if (st === 'error') {
          sessionRef.current = null;
          console.warn('[answer]', err);
          // Keep the question: back in the ask bar, and a Retry in the caption.
          clearHide();
          setCaptionWords([]);
          setAnswerError(true);
          setCaptionVisible(true);
          setRestore((r) => ({ text: q, seq: (r?.seq ?? 0) + 1 }));
          setLiveText(`${ANSWER_FAILED} Retry is available.`);
        }
      },
    });
    sessionRef.current = session;
    void session.start(source);
  }, [director, flash]);

  const onStop = useCallback(() => {
    stopAll(); // the ink stays until the next answer starts
    clearHide();
    setCaptionVisible(false);
  }, [stopAll]);

  const onRetry = useCallback(() => {
    setRestore((r) => ({ text: '', seq: (r?.seq ?? 0) + 1 }));
    if (lastQuestion.current) onAsk(lastQuestion.current);
  }, [onAsk]);

  const onReady = useCallback((api: ViewerApi) => {
    viewerRef.current = api;
    // One desk per viewer (a new document remounts the viewer): regions, connectors, the stage.
    deskRef.current?.destroy();
    const desk = new Desk(api.deskHost(), stageRef.current!);
    deskRef.current = desk;
    desk.subscribe((s) => { setDesk(s); setPaused(desk.follow.paused()); });
    if (import.meta.env.DEV) { window.__viewer = api; window.__desk = desk; }
    setNumPages(api.numPages());
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

  // Esc between answers leaves the stage (while playing, Esc stops the answer first).
  useEffect(() => {
    if (desk?.mode !== 'b') return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && !busyRef.current && !e.defaultPrevented && !typing) void deskRef.current?.exitStage();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desk?.mode]);

  const resumeFollow = useCallback(() => { void deskRef.current?.resume(); }, []);

  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const dock = dockPlacement(viewportW, desk);

  if (!doc) return <EmptyState onFile={openFile} onSample={openSample} error={loadError} />;

  return (
    <>
      {/* Neighbouring pages step back only while an answer is drawing beside a page and the student follows it. */}
      <main
        className={`stage${desk?.sketching && desk.mode === 'c' && desk.following && busy ? ' is-sketching' : ''}`}
        style={{ '--glide': `${GLIDE_MS}ms` } as CSSProperties}
      >
        <PdfViewer
          doc={doc}
          onReady={onReady}
          onPageChange={setPage}
          renderOverlay={(p, H) => <StudentInkLayer page={p} spaceH={H} />}
        />
      </main>
      {/* B: the takeover stage (src/desk/Desk.ts fills it). Above the pages, below the chrome. */}
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
      <div ref={dockRef} className="dock" style={{ '--dock-x': `${dock.x}px`, '--dock-w': `${dock.w}px`, '--glide': `${GLIDE_MS}ms` } as CSSProperties}>
        <Caption
          words={captionWords}
          visible={captionVisible}
          question={question}
          waiting={waiting}
          error={answerError ? { message: ANSWER_FAILED, onRetry } : undefined}
        />
        <AskBar
          onAsk={onAsk}
          onStop={onStop}
          busy={busy}
          suggestions={(isSample || DEV_SCRIPT) && !captionVisible ? SUGGESTIONS : undefined}
          restore={restore}
          transcript={captionVisible ? null : transcript}
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
