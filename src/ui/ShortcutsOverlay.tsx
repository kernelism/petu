// src/ui/ShortcutsOverlay.tsx
import { useEffect, useRef } from 'react';
import { isTypingTarget } from './playbackKeys';
import { isMacPlatform } from './zoomKeys';
import { LARGE_W } from './layout';
import './ui.css';

/**
 * The shortcuts card: every key the app answers to, above the dock. `?` opens it (isShortcutsKey);
 * Esc, `?` or a click outside closes it.
 *
 * Its own keys (Esc, `?`) are taken in a document bubble-phase listener that stops propagation, so
 * the window's bubble listeners (the ask bar's Esc-stops, App's Esc-closes-the-board) never see
 * them. Wire the opener as a window bubble-phase listener too (it then never sees the closing `?`).
 */
type Props = {
  open: boolean;
  onClose(): void;
  /** The card's horizontal centre in view px: the dock's centre (dock left + width / 2). Clamped to the window. */
  x: number;
  /** The dock's top edge as a distance from the window's bottom, px (the card sits 10px above it). Default 96. */
  bottom?: number;
  /** Lists dev-only keys (Shift+R report): pass true on the dev server. */
  dev?: boolean;
  /** ⌘ (macOS) or Ctrl in the keycaps. Default: detected from the platform. */
  mac?: boolean;
};

type Row = { label: string; keys: string[][] };

/**
 * The rows, in groups (a hairline between groups). Each key is one or more keycaps; alternatives are
 * listed side by side. Esc is listed once: it stops or closes whatever is in front (an answer, an
 * aside, drawing). The card's own key (?) is in its header, not a row.
 */
export function shortcutRows(o: { dev?: boolean; mac: boolean }): Row[][] {
  const m = o.mac ? '⌘' : 'Ctrl';
  return [
    [
      { label: 'Ask a question', keys: [['/']] },
      { label: 'Pause / resume', keys: [['Space']] },
      { label: 'Replay the sentence', keys: [['R']] },
      { label: 'Sentence back / forward', keys: [['⇧', '←'], ['⇧', '→']] },
      { label: 'Part back / forward', keys: [['←'], ['→']] },
      { label: 'Slower / faster', keys: [['<'], ['>']] },
      { label: 'Stop · close an aside or drawing', keys: [['Esc']] },
      { label: 'Resume after an aside', keys: [[o.mac ? 'Return' : 'Enter']] },
    ],
    [
      { label: 'Go to page', keys: [['G']] },
      { label: 'Zoom the board', keys: [[m, '+'], [m, '−']] },
      { label: 'Fit the board', keys: [[m, '0']] },
    ],
    [
      { label: 'Draw on / off', keys: [['D']] },
      { label: 'Pen · highlighter · eraser', keys: [['P'], ['H'], ['E']] },
      { label: 'Undo my ink', keys: [[m, 'Z']] },
    ],
    ...(o.dev ? [[{ label: 'Report a problem', keys: [['⇧', 'R']] }]] : []),
  ];
}

/**
 * Opens the card from elsewhere in the chrome (the settings popover's "Show ?"): the same as pressing
 * `?`, which App listens for on the window. Deferred a tick, so the caller's own close lands first.
 */
export function requestShortcuts(): void {
  window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true })), 0);
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'> & { isComposing?: boolean };

/** `?` opens (or closes) the shortcuts card: not while typing, not with ⌘/Ctrl/Alt (Shift is how `?` is typed). */
export function isShortcutsKey(e: KeyLike): boolean {
  return e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.defaultPrevented && !e.isComposing && !isTypingTarget(e.target);
}

/** The card's width (ui.css .keys), and from LARGE_W up. */
const CARD_W = 360;
const CARD_W_LARGE = 400;
/** Below this window height the groups sit in two columns, this wide, so the card stays in the window. */
const SHORT_H = 720;
const WIDE_W = 660;
/** The card sits this far above the dock and keeps this much air under the window's top. */
const GAP = 10;
const TOP_AIR = 16;

/** The card's centre x (clamped into the window), its layout, and the height it may take above the dock. */
export function cardPlace(W: number, H: number, x: number, bottom: number): { wide: boolean; left: number; maxHeight: number } {
  const wide = H < SHORT_H && W >= WIDE_W + 16;
  const half = (wide ? WIDE_W : W >= LARGE_W ? CARD_W_LARGE : CARD_W) / 2 + 8;
  const left = W > 2 * half ? Math.max(half, Math.min(W - half, x)) : W / 2;
  return { wide, left, maxHeight: Math.max(160, H - bottom - GAP - TOP_AIR) };
}

export function ShortcutsOverlay({ open, onClose, x, bottom = 96, dev, mac }: Props) {
  const card = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves into the card while it is open and back to where it was when it closes.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    card.current?.focus({ preventScroll: true });
    return () => {
      const a = document.activeElement;
      if (prev && prev.isConnected && (!a || a === document.body || card.current?.contains(a))) prev.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' || (e.key === '?' && !isTypingTarget(e.target))) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (card.current && e.target instanceof Node && !card.current.contains(e.target)) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  if (!open) return null;
  const W = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const H = typeof window !== 'undefined' ? window.innerHeight : 900;
  const { wide, left, maxHeight } = cardPlace(W, H, x, bottom);
  const groups = shortcutRows({ dev, mac: mac ?? isMacPlatform() });
  return (
    <div
      ref={card}
      className={`keys${wide ? ' is-wide' : ''}`}
      role="dialog"
      aria-labelledby="keys-title"
      tabIndex={-1}
      style={{ left: `${left}px`, bottom: `${bottom + GAP}px`, maxHeight: `${maxHeight}px` }}
    >
      <header className="keys-head">
        <span className="keys-title" id="keys-title">Keyboard shortcuts</span>
        <kbd className="keycap" title="? opens and closes this card">?</kbd>
      </header>
      <div className="keys-body">
        {groups.map((rows, g) => (
          <ul key={g} className="keys-group">
            {rows.map((r) => (
              <li key={r.label} className="keys-row">
                <span className="keys-label">{r.label}</span>
                <span className="keys-caps">
                  {r.keys.map((combo, i) => (
                    <span key={i} className="keys-combo">
                      {combo.map((k) => <kbd key={k} className="keycap">{k}</kbd>)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
