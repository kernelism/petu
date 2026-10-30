// src/ui/Tip.tsx — the one tooltip of the chrome: a small dark label under its button, with the key as
// a keycap ("Draw  D"). The toolbar and the top bar run along the top, so a tip always opens below.
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';
import './ui.css';

type Shown = { label: string; keys?: string; el: HTMLElement };

/** Hover delay before a first tip; once one shows, a neighbour's tip follows at once (as on macOS). */
const DELAY_MS = 400;
const WARM_MS = 250;
/** A tip keeps this far from the window's edges. */
const EDGE = 8;

/** Where a tip `w` wide goes under `r`: centred under it, kept inside the window. `left` is the tip's centre. */
export function tipPlace(r: { left: number; width: number; bottom: number }, w: number, W: number) {
  const c = r.left + r.width / 2;
  const lo = w / 2 + EDGE, hi = W - w / 2 - EDGE;
  return { top: r.bottom + 10, left: lo > hi ? W / 2 : Math.min(Math.max(c, lo), hi) };
}

/** What `props(label, keys)` spreads onto a control. */
export type TipProps = ReturnType<ReturnType<typeof useTips>['props']>;

/**
 * `props(label, keys)` goes on a button: it names it (aria-label, aria-keyshortcuts) and shows the tip
 * on mouse hover (after a beat) or keyboard focus. Render `tip` once, anywhere.
 */
export function useTips() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [w, setW] = useState(0);
  const el = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const hiddenAt = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useLayoutEffect(() => { if (shown && el.current) setW(el.current.offsetWidth); }, [shown]);

  const hide = () => {
    window.clearTimeout(timer.current);
    setShown((t) => { if (t) hiddenAt.current = performance.now(); return null; });
  };
  const props = (label: string, keys?: string) => {
    const show = (target: HTMLElement, delay: number) => {
      window.clearTimeout(timer.current);
      const warm = performance.now() - hiddenAt.current < WARM_MS;
      timer.current = window.setTimeout(() => setShown({ label, keys, el: target }), warm ? 0 : delay);
    };
    return {
      'aria-label': label,
      'aria-keyshortcuts': keys,
      onPointerEnter: (e: PointerEvent<HTMLElement>) => { if (e.pointerType === 'mouse') show(e.currentTarget, DELAY_MS); },
      onPointerLeave: hide,
      onFocus: (e: FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget, 0); },
      onBlur: hide,
      onPointerDown: hide,
    };
  };
  const r = shown?.el.isConnected ? shown.el.getBoundingClientRect() : null;
  const tip = (
    <div ref={el} className={`tb-tip${shown && r ? ' is-visible' : ''}`} style={r ? tipPlace(r, w, window.innerWidth) : undefined} aria-hidden="true">
      {shown?.label}
      {shown?.keys && <kbd className="tb-tip-key">{shown.keys}</kbd>}
    </div>
  );
  return { props, hide, tip, shown: !!shown };
}
