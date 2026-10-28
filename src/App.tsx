import { useCallback, useEffect, useRef, useState } from 'react';
import './styles/tokens.css';
import './app.css';
import { loadPdf, type PdfDoc } from './pdf/loadPdf';
import { PdfViewer } from './pdf/PdfViewer';
import type { ViewerApi } from './pdf/viewerApi';
import { Director, type ActionTiming } from './playback/director';
import { AnswerSession, type SessionState } from './playback/session';
import { PacedClock } from './playback/clock';
import { getSettings, setSettings } from './settings/settings';
import { DEMOS, DEMO_BOARD_QUESTION, DEMO_QUESTION, pickDemo, streamDemo } from './demo/demoScript';
import { SCRIPTS } from './demo/scripts';
import { Board, withBoard, type BoardHandle } from './board/Board';
import { StudentInkLayer } from './ink/student/StudentInkLayer';
import { ink } from './ink/student/store';
import { EmptyState } from './ui/EmptyState';
import { TopBar } from './ui/TopBar';
import { SettingsPopover } from './ui/SettingsPopover';
import { CanvasToolbar } from './ui/CanvasToolbar';
import { PagePill } from './ui/PagePill';
import { Caption } from './ui/Caption';
import { AskBar } from './ui/AskBar';
import { BOARD_PAGE, type Action } from './script/types';

const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
// Dev-only review autoplay: ?demo=1 plays the PDF demo, ?demo=board the board demo.
const demoParam = import.meta.env.DEV ? params.get('demo') : null;
const DEMO = demoParam === '1' ? DEMO_QUESTION : demoParam === 'board' ? DEMO_BOARD_QUESTION : null;
// Dev-only: ?src=<pdf url>&script=<name> opens that PDF and plays a named script (src/demo/scripts.ts).
// ?script=<name> alone uses that script's own PDF.
const scriptParam = import.meta.env.DEV ? params.get('script') : null;
const DEV_SCRIPT = scriptParam ? SCRIPTS[scriptParam] ?? null : null;
const DEV_SRC = import.meta.env.DEV ? params.get('src') ?? DEV_SCRIPT?.src ?? null : null;
if (scriptParam && !DEV_SCRIPT) console.warn('[dev] unknown ?script=; known:', Object.keys(SCRIPTS).join(', '));
const SUGGESTIONS = DEV_SCRIPT ? [DEV_SCRIPT.question] : DEMOS.map((d) => d.question);
/** Column glide when the board opens or closes. Matches .stage / .board transitions in CSS. */
const BOARD_GLIDE_MS = 420;
/** A new answer keeps the board open only if a board action shows up within this much of the stream. */
const BOARD_LOOKAHEAD_CHARS = 160;
const usesBoard = (a: Action) => a.kind === 'board' || ('page' in a && a.page === BOARD_PAGE);
const SAMPLE_URL = '/fixtures/epipolar.pdf';
const SAMPLE_NAME = 'Stereo Vision — sample.pdf';
const CAPTION_LINGER_MS = 2200;
const NOT_SAMPLE = 'The agent connects in the next checkpoint; open the sample deck to see a demo.';

// Review aid: ?style=live|hand|clean picks the drawing style.
const styleParam = params.get('style');
if (styleParam === 'live' || styleParam === 'hand' || styleParam === 'clean') setSettings({ inkStyle: styleParam });

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

declare global {
  interface Window { __viewer?: ViewerApi; __timings?: DebugState }
}

// ------------------------------------------------------------------------------------------------
// ?debug: latency from Enter, plus a rolling log of actions and how long each waited in the queue.

type DebugState = { chunk?: number; word?: number; action?: number; log: ActionTiming[] };

function describe(a: Action): string {
  if (a.kind === 'clear' || a.kind === 'board') return a.kind;
  const cut = (t: string) => ` "${t.length > 18 ? `${t.slice(0, 17)}…` : t}"`;
  const q = 'quote' in a ? cut(a.quote) : a.kind === 'label' || a.kind === 'write' ? cut(a.text) : '';
  return `${a.kind} ${a.page === BOARD_PAGE ? 'board' : `p${a.page}`}${q}`;
}

/** Compact, bottom-left, collapsed by default so it never covers the page. Click to expand. */
function DebugPanel({ d, t0 }: { d: DebugState; t0: number }) {
  const [open, setOpen] = useState(false);
  const ms = (t?: number) => (t == null ? '—' : `${Math.round(t - t0)}ms`);
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
      {d.log.length > 0 && <div className="debug-head"><span>action</span><span>at · wait · run</span></div>}
      {d.log.slice(-8).map((t, i) => (
        <div key={i} className={`debug-row${t.skipped ? ' is-skipped' : ''}`} title={t.skipped}>
          <span className="debug-act">{describe(t.action)}</span>
          <span>
            {Math.round(t.firedAt - t0)} · {Math.round(t.startedAt - t.firedAt)} · {t.endedAt == null ? '…' : t.skipped ? 'skip' : Math.round(t.endedAt - t.startedAt)}
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
  const [pill, setPill] = useState<{ page: number | null; seq: number }>({ page: null, seq: 0 });
  const [boardOpen, setBoardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const [debug, setDebug] = useState<DebugState>({ log: [] });
  const [askT0, setAskT0] = useState(0);

  const viewerRef = useRef<ViewerApi | null>(null);
  const boardRef = useRef<BoardHandle>(null);
  const boardOpenRef = useRef(false);
  /** Resolves when the current column glide has finished and the viewer has re-laid out. */
  const glideDone = useRef<Promise<void>>(Promise.resolve());
  /** While an answer decides whether to keep the open board, its actions wait here. */
  const gateRef = useRef<Promise<void> | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  /** Opens or closes the board: the column glides and the pages follow by transform. */
  const setBoard = useCallback((open: boolean, animate = true) => {
    if (boardOpenRef.current === open) return;
    boardOpenRef.current = open;
    const W = window.innerWidth;
    const target = open ? W - 72 - Math.max(0.45 * W - 36, 380) : W; // see --board-w in app.css
    const v = viewerRef.current;
    glideDone.current = v ? v.glideColumn(target, animate ? BOARD_GLIDE_MS : 0) : Promise.resolve();
    setBoardOpen(open);
  }, []);
  const sessionRef = useRef<AnswerSession | null>(null);
  const isSampleRef = useRef(false);
  isSampleRef.current = isSample;
  const hideTimer = useRef<number>();
  const demoStarted = useRef(false);
  const loadSeq = useRef(0);

  const directorRef = useRef<Director>();
  if (!directorRef.current) {
    directorRef.current = new Director({
      viewer: () => viewerRef.current && withBoard(viewerRef.current, boardRef.current),
      settings: getSettings,
      onScrolledTo: (page) => setPill((p) => ({ page, seq: p.seq + 1 })),
      // Opening is idempotent: a second board action during the glide waits only for what's left of it.
      openBoard: () => { setBoard(true); return glideDone.current; },
      board: () => boardRef.current,
      gate: () => gateRef.current,
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

  /** Shows a one-off line in the caption, then fades it. */
  const flash = useCallback((text: string, ms = 4000) => {
    clearHide();
    setCaptionWords(text.split(' '));
    setCaptionVisible(true);
    hideTimer.current = window.setTimeout(() => setCaptionVisible(false), ms);
  }, []);

  const stopAll = useCallback(() => {
    const s = sessionRef.current;
    sessionRef.current = null;
    s?.stop();
    director.stop();
    gateRef.current = null;
    setBusy(false);
  }, [director]);

  // ---------------------------------------------------------------------------------------------
  // Documents

  const open = useCallback(async (src: ArrayBuffer | string, name: string, sample: boolean) => {
    const seq = ++loadSeq.current;
    try {
      const d = await loadPdf(src);
      if (seq !== loadSeq.current) { void d.destroy(); return; }
      stopAll();
      clearHide();
      setCaptionVisible(false);
      setCaptionWords([]);
      ink.reset();
      setBoard(false, false);
      boardRef.current?.layers()?.agent.replaceChildren();
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
  }, [stopAll, setBoard]);

  const openSample = useCallback(() => open(SAMPLE_URL, SAMPLE_NAME, true), [open]);
  const openFile = useCallback(async (f: File) => open(await f.arrayBuffer(), f.name, false), [open]);

  const closeDoc = useCallback(() => {
    loadSeq.current++;
    stopAll();
    clearHide();
    setCaptionVisible(false);
    setCaptionWords([]);
    setSettingsOpen(false);
    ink.reset();
    setBoard(false, false);
    boardRef.current?.layers()?.agent.replaceChildren();
    viewerRef.current = null;
    setDoc(null);
    setFileName('');
    setIsSample(false);
    setLoadError(undefined);
  }, [stopAll, setBoard]);

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
    gateRef.current = null;
    clearHide();
    // The old ink fades at the head of the director's queue while the request goes out.
    void director.begin(300);
    if (!isSampleRef.current && !DEV_SCRIPT) { setBusy(false); flash(NOT_SAMPLE); return; }

    setCaptionWords([]);
    setCaptionVisible(true);
    setBusy(true);
    if (DEBUG) { setAskT0(t0); setDebug({ log: [] }); }

    // An open board stays only if this answer uses it. The decision waits for the first word (so a
    // board answer never flickers closed) and for a little lookahead in the stream (or its end).
    // Until then actions wait (a scroll aimed at the narrow column would land wrong once it widens);
    // when the board closes they also wait out the glide.
    let boardSeen = false, spoke = false, streamed = 0, streamDone = false, decided = !boardOpenRef.current;
    let openGate = () => {};
    gateRef.current = decided ? null : new Promise<void>((r) => { openGate = r; });
    const decide = () => {
      if (decided || sessionRef.current !== session) return;
      if (boardSeen) { decided = true; gateRef.current = null; openGate(); return; }
      if (spoke && (streamed >= BOARD_LOOKAHEAD_CHARS || streamDone)) {
        decided = true;
        setBoard(false);
        void glideDone.current.then(() => { if (gateRef.current === gate) gateRef.current = null; openGate(); });
      }
    };
    const gate = gateRef.current;

    let firstChunk = true;
    const source = async function* (signal: AbortSignal) {
      for await (const c of streamDemo(signal, demo.script)) {
        if (firstChunk && DEBUG) { firstChunk = false; const t = performance.now(); setDebug((d) => ({ ...d, chunk: t })); }
        streamed += c.length;
        yield c;
        decide();
      }
      streamDone = true;
      decide();
    };

    const session: AnswerSession = new AnswerSession({
      clock: new PacedClock(() => getSettings().wpm),
      onParsed: (a) => { if (usesBoard(a)) boardSeen = true; director.prefetch(a); },
      onAction: (a) => { if (sessionRef.current === session) director.run(a); },
      onWord: (words) => {
        if (sessionRef.current !== session) return;
        if (DEBUG && words.length === 1) { const t = performance.now(); setDebug((d) => ({ ...d, word: t })); }
        if (!spoke) { spoke = true; decide(); }
        setCaptionWords(words);
      },
      onState: (st: SessionState, err?: string) => {
        if (sessionRef.current !== session) return;
        if (st === 'loading' || st === 'playing') { setBusy(true); return; }
        setBusy(false);
        if (st === 'done') {
          sessionRef.current = null;
          hideTimer.current = window.setTimeout(() => setCaptionVisible(false), CAPTION_LINGER_MS);
        } else if (st === 'error') {
          sessionRef.current = null;
          console.warn('[answer]', err);
          flash("Something went wrong. Ask again to retry.", 4000);
        }
      },
    });
    sessionRef.current = session;
    void session.start(source);
  }, [director, flash, setBoard]);

  const onStop = useCallback(() => {
    stopAll(); // the ink stays until the next answer starts
    clearHide();
    setCaptionVisible(false);
  }, [stopAll]);

  const onReady = useCallback((api: ViewerApi) => {
    viewerRef.current = api;
    if (import.meta.env.DEV) window.__viewer = api;
    setNumPages(api.numPages());
    const autoplay = DEV_SCRIPT ? DEV_SCRIPT.question : DEMO && isSampleRef.current ? DEMO : null;
    if (autoplay && !demoStarted.current && !params.has('noplay')) {
      demoStarted.current = true;
      window.setTimeout(() => onAsk(autoplay), 800);
    }
  }, [onAsk]);

  // Dev-only review autoplay: ?src= opens that PDF, ?demo= the sample deck (plays once, see onReady).
  useEffect(() => {
    if (DEV_SRC) void open(DEV_SRC, decodeURIComponent(DEV_SRC.split('/').pop() ?? 'document.pdf'), false);
    else if (DEMO) void openSample();
  }, [open, openSample]);

  const closeBoard = useCallback(() => setBoard(false), [setBoard]);

  // Esc closes the board when nothing is playing (while playing, Esc stops the answer first).
  useEffect(() => {
    if (!boardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === 'Escape' && !busyRef.current && !e.defaultPrevented && !typing) setBoard(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [boardOpen, setBoard]);

  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  if (!doc) return <EmptyState onFile={openFile} onSample={openSample} error={loadError} />;

  return (
    <>
      {/* The stage is the viewer's column; a side panel can later narrow it without touching the viewer. */}
      <main className={`stage${boardOpen ? ' has-board' : ''}`}>
        <PdfViewer
          doc={doc}
          onReady={onReady}
          onPageChange={setPage}
          renderOverlay={(p, H) => <StudentInkLayer page={p} spaceH={H} />}
        />
      </main>
      <Board ref={boardRef} open={boardOpen} onClose={closeBoard} />
      <TopBar fileName={fileName} page={page} numPages={numPages || doc.numPages} onOpenSettings={toggleSettings} onClose={closeDoc} />
      <SettingsPopover open={settingsOpen} onClose={closeSettings} />
      <CanvasToolbar />
      <PagePill page={pill.page} seq={pill.seq} />
      <Caption words={captionWords} visible={captionVisible} />
      <AskBar onAsk={onAsk} onStop={onStop} busy={busy} suggestions={(isSample || DEV_SCRIPT) && !captionVisible ? SUGGESTIONS : undefined} />
      <div className={`dropveil${dragging ? ' is-visible' : ''}`} aria-hidden="true">
        <div className="dropveil-label">Drop to open</div>
      </div>
      {DEBUG && <DebugPanel d={debug} t0={askT0} />}
    </>
  );
}
