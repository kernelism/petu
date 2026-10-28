// src/desk/kit/anim.ts
/**
 * Kit motion: eased tweens on requestAnimationFrame, and one rule for overlapping animations on a
 * block. A block's state (its values, its window) has at most one animation running. A later tag
 * that changes that state first fast-forwards the running one (it jumps to its end state at once),
 * then starts: so the board never drifts behind the narration and never shows two half-states.
 * Overlays (emph, fade) never interrupt anything. Reduced motion: tweens land at once; a sweep still
 * steps (discrete changes, no gliding).
 */
import { prefersReducedMotion } from '../../ink/agent/animate';

export const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;

const frame = () => new Promise<number>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(r) : setTimeout(() => r(performance.now()), 16)));
const now = () => performance.now();

/** A running animation's control: `ff` makes every tween and pause in it complete at once. */
export class Ctl {
  ff = false;
  done: Promise<void>;
  private resolve!: () => void;
  constructor() { this.done = new Promise((r) => { this.resolve = r; }); }
  finish(): void { this.resolve(); }
}

/** Calls f(eased t) every frame for `ms`, ending on f(1). Instant when ms ≤ 0, fast-forwarded, or reduced motion. */
export async function tween(ms: number, f: (t: number) => void, ctl?: Ctl, ease = easeInOut): Promise<void> {
  if (ms <= 0 || ctl?.ff || prefersReducedMotion()) { f(1); return; }
  const t0 = now();
  for (;;) {
    const t = ctl?.ff ? 1 : Math.min(1, (now() - t0) / ms);
    f(ease(t));
    if (t >= 1) return;
    await frame();
  }
}

/** Waits `ms`, or less if fast-forwarded. */
export async function pause(ms: number, ctl?: Ctl): Promise<void> {
  if (ms <= 0 || ctl?.ff) return;
  const t0 = now();
  while (!ctl?.ff && now() - t0 < ms) await frame();
}

/**
 * One state animation per block. `run(ids, fn)` fast-forwards whatever runs on any of `ids`, waits
 * for it to land, then runs fn with a fresh Ctl owning all of them. Resolves `started` once fn has
 * begun and `done` when it ends (a fast-forward ends it early, in its end state).
 */
export class Animations {
  private running = new Map<string, Ctl>();

  async run(ids: string[], fn: (ctl: Ctl) => Promise<void>): Promise<void> {
    const prev = [...new Set(ids.map((id) => this.running.get(id)).filter((c): c is Ctl => !!c))];
    prev.forEach((c) => { c.ff = true; });
    await Promise.all(prev.map((c) => c.done));
    const ctl = new Ctl();
    ids.forEach((id) => this.running.set(id, ctl));
    try { await fn(ctl); }
    finally {
      ids.forEach((id) => { if (this.running.get(id) === ctl) this.running.delete(id); });
      ctl.finish();
    }
  }

  /** Whether an animation is running on `id`. */
  busy(id: string): boolean { return this.running.has(id); }

  /** Fast-forwards everything (an answer stopped or replaced). */
  settle(): void { this.running.forEach((c) => { c.ff = true; }); }
}
