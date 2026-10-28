import { prefersReducedMotion } from '../ink/agent/animate';

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export type ScrollOpts = {
  /** Nominal duration; scaled by distance and clamped to [300, maxMs]. Default 500. */
  ms?: number;
  /** Longest glide. Default 600. */
  maxMs?: number;
  /** Aborting stops the glide where it is and resolves. */
  signal?: AbortSignal;
};

/**
 * Smoothly scrolls `el` so its scrollTop reaches `target`. A function target is re-read every frame
 * (and re-clamped to the scroll range), so a layout change mid-glide still lands on the right spot.
 * Resolves early if the user takes over (wheel/touch/key) or `signal` aborts. Under reduced motion it jumps.
 */
export function animateScrollTo(el: HTMLElement, target: number | (() => number), o: ScrollOpts = {}): Promise<void> {
  const read = () => {
    const t = typeof target === 'function' ? target() : target;
    return Math.max(0, Math.min(t, el.scrollHeight - el.clientHeight));
  };
  const from = el.scrollTop;
  const to0 = read();
  if (Math.abs(to0 - from) < 2 || o.signal?.aborted) return Promise.resolve();
  if (prefersReducedMotion()) { el.scrollTop = to0; return Promise.resolve(); }
  const dur = Math.min(o.maxMs ?? 600, Math.max(300, (o.ms ?? 500) * Math.min(1.4, Math.abs(to0 - from) / 1200 + 0.6)));
  return new Promise((resolve) => {
    let done = false;
    const events = ['wheel', 'touchstart', 'keydown'];
    const cleanup = () => { events.forEach((e) => el.removeEventListener(e, stop)); o.signal?.removeEventListener('abort', stop); };
    const stop = () => { if (done) return; done = true; cleanup(); resolve(); };
    events.forEach((e) => el.addEventListener(e, stop, { passive: true }));
    o.signal?.addEventListener('abort', stop);
    const t0 = performance.now();
    const tick = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / dur);
      el.scrollTop = from + (read() - from) * easeInOutCubic(t);
      if (t < 1) requestAnimationFrame(tick); else stop();
    };
    requestAnimationFrame(tick);
  });
}
