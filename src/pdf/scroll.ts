const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Smoothly scrolls `el` to `top`. Resolves early if the user takes over (wheel/touch/key). */
export function animateScrollTo(el: HTMLElement, top: number, ms = 650): Promise<void> {
  const from = el.scrollTop;
  const to = Math.max(0, Math.min(top, el.scrollHeight - el.clientHeight));
  if (Math.abs(to - from) < 2) return Promise.resolve();
  const dur = Math.min(900, Math.max(350, ms * Math.min(1.4, Math.abs(to - from) / 1200 + 0.6)));
  return new Promise((resolve) => {
    let done = false;
    const stop = () => { done = true; cleanup(); resolve(); };
    const cleanup = () => ['wheel', 'touchstart', 'keydown'].forEach((e) => el.removeEventListener(e, stop));
    ['wheel', 'touchstart', 'keydown'].forEach((e) => el.addEventListener(e, stop, { passive: true }));
    const t0 = performance.now();
    const tick = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / dur);
      el.scrollTop = from + (to - from) * easeInOutCubic(t);
      if (t < 1) requestAnimationFrame(tick); else { cleanup(); resolve(); }
    };
    requestAnimationFrame(tick);
  });
}
