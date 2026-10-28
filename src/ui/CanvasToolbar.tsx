import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, Eraser, Highlighter, Pencil, PenLine, Trash2, Undo2 } from 'lucide-react';
import { ink, PEN_COLORS, useInk, type Tool } from '../ink/student/store';
import { getSettings, useSettings } from '../settings/settings';
import './ui.css';

const ICON = { size: 18, strokeWidth: 1.75 } as const;
const COLOR_NAMES = ['Black', 'Red', 'Blue', 'Green', 'Orange'];
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const UNDO_KEY = isMac ? '⌘Z' : 'Ctrl+Z';

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

type Tip = { label: string; keys?: string; el: HTMLElement };

const HINT_KEY = 'pdf-tutor.drawHintSeen';
const HINT_MS = 4000;
const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };
const markHintSeen = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ } };

/** Single-key shortcuts act only while drawing, or while the page (stage) or this toolbar has focus. */
const keysActive = (canvasOn: boolean) => {
  if (canvasOn) return true;
  const a = document.activeElement;
  return !!a && a !== document.body && !!a.closest('.stage, .desk-stage, .toolbar');
};

export function CanvasToolbar() {
  const { canvasOn, tool, color, strokes, undo } = useInk();
  const { shortcuts } = useSettings();
  // One-time hint beside the pencil on first load; fades after HINT_MS or on first use.
  const [hint, setHint] = useState(() => !hintSeen());
  const pencilRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => { setHint(false); markHintSeen(); }, HINT_MS);
    return () => window.clearTimeout(t);
  }, [hint]);
  useEffect(() => { if (canvasOn && hint) { setHint(false); markHintSeen(); } }, [canvasOn, hint]);
  const [tip, setTip] = useState<Tip | null>(null);
  const tipTimer = useRef<number>();
  const tipHiddenAt = useRef(0);
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
      if (mod || e.altKey) return;
      const on = ink.get().canvasOn;
      const letters = getSettings().shortcuts && keysActive(on);
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
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(tipTimer.current); };
  }, []);
  useEffect(() => setTip(null), [canvasOn]);
  useEffect(() => relayout((n) => n + 1), []); // place the first-load hint once the pencil is laid out

  // One shared tooltip, placed under the hovered/focused button. Like macOS, once a tip
  // is showing, moving to a neighbour shows its tip immediately.
  const tipProps = (label: string, keys?: string) => {
    const show = (el: HTMLElement, delay: number) => {
      window.clearTimeout(tipTimer.current);
      const warm = performance.now() - tipHiddenAt.current < 250;
      tipTimer.current = window.setTimeout(() => setTip({ label, keys, el }), warm ? 0 : delay);
    };
    const hide = () => {
      window.clearTimeout(tipTimer.current);
      setTip((t) => { if (t) tipHiddenAt.current = performance.now(); return null; });
    };
    return {
      'aria-label': label,
      'aria-keyshortcuts': keys,
      onPointerEnter: (e: PointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse') show(e.currentTarget, 400); },
      onPointerLeave: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 0); },
      onBlur: hide,
      onPointerDown: hide,
    };
  };
  const tipRect = tip?.el.isConnected ? tip.el.getBoundingClientRect() : null;
  const pencilRect = pencilRef.current?.isConnected ? pencilRef.current.getBoundingClientRect() : null;
  const key = (k: string) => (shortcuts ? k : undefined);

  const toolBtn = (t: Tool, label: string, key: string, icon: ReactNode) => (
    <button
      type="button"
      className={`tb-btn${tool === t ? ' is-active' : ''}`}
      aria-pressed={tool === t}
      onClick={() => ink.setTool(t)}
      {...tipProps(label, shortcuts ? key : undefined)}
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
            <button ref={pencilRef} type="button" className="tb-btn" tabIndex={canvasOn ? -1 : 0} onClick={() => ink.setCanvas(true)} {...tipProps('Draw', key('D'))}>
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
                {...tipProps(COLOR_NAMES[i] ?? c)}
              >
                <span className="tb-dot" style={{ '--dot': c } as CSSProperties} />
              </button>
            ))}
            <div className="tb-divider" />
            <button type="button" className="tb-btn" disabled={!undo.length} onClick={() => ink.undoLast()} {...tipProps('Undo', UNDO_KEY)}>
              <Undo2 {...ICON} />
            </button>
            <button type="button" className="tb-btn" disabled={!strokes.length} onClick={() => ink.clear()} {...tipProps('Clear my ink')}>
              <Trash2 {...ICON} />
            </button>
            <button type="button" className="tb-btn" onClick={() => ink.setCanvas(false)} {...tipProps('Done', 'Esc')}>
              <Check {...ICON} />
            </button>
          </div>
        </div>
      </div>
      {/* The one-time hint uses the tooltip's look, so a hover tip later reads as the same thing. */}
      <div
        className={`tb-tip tb-hint${hint && !tip && pencilRect ? ' is-visible' : ''}`}
        style={pencilRect ? { top: pencilRect.bottom + 10, left: Math.max(pencilRect.left + pencilRect.width / 2, 48) } : undefined}
        aria-hidden="true"
      >
        Draw
        {shortcuts && <kbd className="tb-tip-key">D</kbd>}
      </div>
      <div
        className={`tb-tip${tip && tipRect ? ' is-visible' : ''}`}
        style={tipRect ? { top: tipRect.bottom + 10, left: Math.max(tipRect.left + tipRect.width / 2, 48) } : undefined}
        aria-hidden="true"
      >
        {tip?.label}
        {tip?.keys && <kbd className="tb-tip-key">{tip.keys}</kbd>}
      </div>
    </>
  );
}
