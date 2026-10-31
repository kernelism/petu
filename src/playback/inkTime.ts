// src/playback/inkTime.ts — the time ink draws on: wall-clock time that stands still while its answer is paused.
/**
 * Ink paced to the narration plans in absolute times (performance.now()). A pause (Space, the pause
 * button, typing in the bar, an aside) stops the narration (Scheduler.pause); ink drawn on an InkTime
 * stops with it: its time doesn't run, its frames and sleeps wait, and its CSS fades are held (`hold`).
 * On resume every planned time is later by exactly the pause, so the drawing goes on from where it
 * stood, still on its words. A stop (the drawing's signal) wakes every wait at once.
 */
/** Whether the answer the ink belongs to is paused (AnswerSession.isPaused). */
export type Paused = () => boolean;

/** While paused (or sleeping), the pause is re-read this often. */
export const INK_POLL_MS = 32;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));
const raf = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

export class InkTime {
  private off = 0;
  private since: number | null = null;
  /** `hold(true)` as a pause begins, `hold(false)` as it ends (or on release): CSS fades in flight stop and go on with it. */
  constructor(private paused?: Paused, private hold?: (held: boolean) => void) {}

  /** performance.now() less the time spent paused (it stands still while paused). */
  now(): number {
    const t = performance.now();
    const p = !!this.paused?.();
    if (p && this.since == null) { this.since = t; this.hold?.(true); }
    else if (!p && this.since != null) { this.off += t - this.since; this.since = null; this.hold?.(false); }
    return (this.since ?? t) - this.off;
  }

  /** The next animation frame the answer isn't paused on. */
  async frame(signal?: AbortSignal): Promise<void> {
    await raf();
    this.now();
    while (this.since != null && !signal?.aborted) { await wait(INK_POLL_MS); this.now(); }
  }

  /** Waits `ms` of ink time (≤ 0: only until the answer isn't paused). */
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    const end = this.now() + ms;
    for (;;) {
      if (signal?.aborted) return;
      const d = end - this.now();
      if (d <= 0 && this.since == null) return;
      await wait(this.since != null ? INK_POLL_MS : Math.min(d, INK_POLL_MS));
    }
  }

  /** Lets go of a held pause (a stop lands the drawing while paused: its fades play on). */
  release(): void {
    if (this.since == null) return;
    this.since = null;
    this.hold?.(false);
  }
}

/** Holds (or plays on) every CSS transition and animation under `el`. */
export function holdFades(el: Element, held: boolean): void {
  try { for (const a of el.getAnimations?.({ subtree: true }) ?? []) { if (held) a.pause(); else a.play(); } } catch { /* no Web Animations */ }
}
