// src/ui/glide.ts — chrome that follows the slide column (the dock, the route row) glides as a
// transform, not as `left`. Its owner sets `left` inline as before; the new left lands at once and an
// equal and opposite `translate` takes it back to where it was on screen, then transitions to zero
// (FLIP). The move is composited: no layout per frame, and nothing under it re-flows.
//
// The offset rides on the `translate` property, so an element's own `transform` (the dock's centring,
// the route row's show/hide) is untouched. CSS gives the element `transition: translate …`.

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The offset (px) that puts an element whose left just changed from `prev` to `next` back where it
 * showed, given the offset it was still gliding out (`inFlight`, 0 when at rest).
 */
export const glideOffset = (prev: number, next: number, inFlight = 0) => prev + inFlight - next;

/** Starts gliding `el` whenever its inline `left` changes. Returns the stop function. */
export function glideOnMove(el: HTMLElement): () => void {
  let last = parseFloat(el.style.left);
  const obs = new MutationObserver(() => {
    const next = parseFloat(el.style.left);
    if (!Number.isFinite(next) || next === last) return;
    const prev = last;
    last = next;
    if (!Number.isFinite(prev) || reduced()) return;
    const inFlight = parseFloat(getComputedStyle(el).translate) || 0;
    const dx = glideOffset(prev, next, inFlight);
    if (Math.abs(dx) < 0.5) return;
    el.style.transition = 'none';
    el.style.translate = `${dx}px 0`;
    void el.offsetWidth; // the offset is the starting point
    el.style.transition = '';
    el.style.translate = '';
  });
  obs.observe(el, { attributes: true, attributeFilter: ['style'] });
  return () => obs.disconnect();
}

/**
 * The dock is App's (caption + ask bar, left/width inline). Until App holds its own ref to call
 * glideOnMove with, the chrome installs it here once the dock is in the document.
 */
export function glideDock(): () => void {
  const dock = document.querySelector<HTMLElement>('.dock');
  return dock ? glideOnMove(dock) : () => {};
}
