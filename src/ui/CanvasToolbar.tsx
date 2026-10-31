import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Eraser, Highlighter, Pencil, PenLine, Trash2, Undo2 } from 'lucide-react';
import { ink, PEN_COLORS, useInk, type Tool } from '../ink/student/store';
import { useTips, tipPlace } from './Tip';
import { isMacPlatform } from './zoomKeys';
import './ui.css';

const ICON = { size: 18, strokeWidth: 1.75 } as const;
/** Names of PEN_COLORS, in its order. */
const COLOR_NAMES = ['Blue', 'Black', 'Red', 'Green', 'Orange'];
const UNDO_KEY = isMacPlatform() ? '⌘Z' : 'Ctrl+Z';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const HINT_KEY = 'pdf-tutor.drawHintSeen';
const HINT_MS = 4000;
/** The hint's width ("Draw" + keycap), for keeping it inside the window. */
const HINT_W = 72;
const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const markHintSeen = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ } };

/**
 * Single-key shortcuts act while drawing, or while nothing in particular has focus (the body: how the
 * app opens) or the page (stage), the board or this toolbar has it. Never with a popover or card open.
 */
export function keysActive(canvasOn: boolean, active: Element | null = document.activeElement, doc: ParentNode = document): boolean {
  if (doc.querySelector('.popover, .keys')) return false;
  if (canvasOn) return true;
  if (!active || active === document.body || active === document.documentElement) return true;
  return !!active.closest('.stage, .desk-stage, .toolbar');
}

/** `showHint`: the one-time "Draw D" hint may show (App passes true once the first answer has ended). */
export function CanvasToolbar({ showHint = false }: { showHint?: boolean } = {}) {
  const { canvasOn, tool, color, strokes, undo } = useInk();
  // One-time hint under the pencil after the first answer; fades after HINT_MS or on first use.
  const [hint, setHint] = useState(() => !hintSeen());
  const pencilRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!hint || !showHint) return;
    const t = window.setTimeout(() => { setHint(false); markHintSeen(); }, HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint, showHint]);
  useEffect(() => { if (canvasOn && hint) { setHint(false); markHintSeen(); } }, [canvasOn, hint]);
  const tips = useTips();
  const [, relayout] = useState(0);
  const openFold = useRef<HTMLDivElement>(null);
  useEffect(() => { if (openFold.current) openFold.current.inert = !canvasOn; }, [canvasOn]);

  // Keyboard shortcuts. Capture phase so Esc can be claimed before the ask bar treats it as "stop".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey && !e.altKey) {
        if (!ink.get().undo.length) return;
        e.preventDefault();
        ink.undoLast();
        return;
      }
      if (mod || e.altKey || e.repeat) return;
      const on = ink.get().canvasOn;
      const letters = keysActive(on);
      if (letters && k === 'd') { ink.setCanvas(!on); }
      else if (letters && k === 'p') { ink.setTool('pen'); }
      else if (letters && k === 'h') { ink.setTool('highlighter'); }
      else if (letters && k === 'e') { ink.setTool('eraser'); }
      else if (e.key === 'Escape' && on && !document.querySelector('.popover')) { ink.setCanvas(false); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    const onResize = () => relayout((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => tips.hide(), [canvasOn]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => relayout((n) => n + 1), [showHint]); // place the hint once the pencil is laid out
  const pencilRect = pencilRef.current?.isConnected ? pencilRef.current.getBoundingClientRect() : null;

  const toolBtn = (t: Tool, label: string, k: string, icon: ReactNode) => (
    <button
      type="button"
      className={`tb-btn${tool === t ? ' is-active' : ''}`}
      aria-pressed={tool === t}
      onClick={() => ink.setTool(t)}
      {...tips.props(label, k)}
    >
      {icon}
    </button>
  );

  return (
    <>
      <div
        className={`toolbar${canvasOn ? ' is-open' : ''}`}
        onTransitionEnd={() => relayout((n) => n + 1)}
        role="toolbar" aria-label="Drawing tools" aria-orientation="horizontal">
        <div className="tb-fold tb-fold-closed" aria-hidden={canvasOn}>
          <div className="tb-fold-inner">
            <button ref={pencilRef} type="button" className="tb-btn" tabIndex={canvasOn ? -1 : 0} onClick={() => ink.setCanvas(true)} {...tips.props('Draw', 'D')}>
              <Pencil {...ICON} />
            </button>
          </div>
        </div>
        <div className="tb-fold tb-fold-open" aria-hidden={!canvasOn} ref={openFold}>
          <div className="tb-fold-inner">
            {toolBtn('pen', 'Pen', 'P', <PenLine {...ICON} />)}
            {toolBtn('highlighter', 'Highlighter', 'H', <Highlighter {...ICON} />)}
            {toolBtn('eraser', 'Eraser', 'E', <Eraser {...ICON} />)}
            <div className="tb-divider" />
            {PEN_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                className={`tb-btn tb-color${color === c ? ' is-on' : ''}`}
                aria-pressed={color === c}
                onClick={() => { ink.setColor(c); if (tool === 'eraser') ink.setTool('pen'); }}
                {...tips.props(COLOR_NAMES[i] ?? c)}
              >
                <span className="tb-dot" style={{ '--dot': c } as CSSProperties} />
              </button>
            ))}
            <div className="tb-divider" />
            <button type="button" className="tb-btn" disabled={!undo.length} onClick={() => ink.undoLast()} {...tips.props('Undo', UNDO_KEY)}>
              <Undo2 {...ICON} />
            </button>
            <button type="button" className="tb-btn" disabled={!strokes.length} onClick={() => ink.clear()} {...tips.props('Clear my ink')}>
              <Trash2 {...ICON} />
            </button>
            <button type="button" className="tb-btn" onClick={() => ink.setCanvas(false)} {...tips.props('Done', 'Esc')}>
              <Check {...ICON} />
            </button>
          </div>
        </div>
      </div>
      {/* The one-time hint uses the tooltip's look, so a hover tip later reads as the same thing. */}
      <div
        className={`tb-tip tb-hint${hint && showHint && !tips.shown && pencilRect ? ' is-visible' : ''}`}
        style={pencilRect ? tipPlace(pencilRect, HINT_W, window.innerWidth) : undefined}
        aria-hidden="true"
      >
        Draw
        <kbd className="tb-tip-key">D</kbd>
      </div>
      {tips.tip}
    </>
  );
}
