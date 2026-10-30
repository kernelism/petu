// src/desk/follow.ts
/**
 * Rule 6: who drives the view. While an answer plays the engine follows it; the moment the student
 * scrolls or zooms, it stops moving the view until they ask to go back. Ink still draws where it
 * belongs either way.
 */
export class Follow {
  private on = true;
  private answering = false;
  private subs = new Set<() => void>();

  following(): boolean { return this.on; }
  /** Whether the "Back to answer" pill should show. */
  paused(): boolean { return this.answering && !this.on; }

  /** An answer starts or ends. A new answer always follows. */
  setAnswering(a: boolean): void {
    this.answering = a;
    if (a) this.on = true;
    this.emit();
  }
  /** The student scrolled or zoomed. Ignored between answers (there is nothing to follow). */
  userTookOver(): void {
    if (!this.answering || !this.on) return;
    this.on = false;
    this.emit();
  }
  resume(): void {
    if (this.on) return;
    this.on = true;
    this.emit();
  }
  subscribe(f: () => void): () => void { this.subs.add(f); return () => { this.subs.delete(f); }; }
  private emit() { this.subs.forEach((f) => f()); }
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

/** Focused things that take these keys themselves: typing, or a control the key activates (Space on a button). */
const OWNS_KEYS = 'input, textarea, select, button, [role="button"], [contenteditable]:not([contenteditable="false"])';

/** Keys that scroll the page (when not typing into or operating a focused control). */
export const isScrollKey = (e: { key: string; target?: EventTarget | null }) => {
  const t = e.target as HTMLElement | null;
  const owned = !!t && (t.isContentEditable || !!t.closest?.(OWNS_KEYS));
  return !owned && SCROLL_KEYS.has(e.key);
};

/**
 * Whether a wheel event will scroll `el`: it has a delta in a direction `el` still has room to go. A
 * wheel that moves nothing (a trackpad or touch-surface mouse brushed while the cursor moves, the
 * board already at its end) is not the student taking over.
 */
export function wheelScrolls(el: { scrollTop: number; scrollLeft: number; scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number }, e: { deltaX: number; deltaY: number }): boolean {
  const dy = e.deltaY, dx = e.deltaX;
  if (dy < 0 && el.scrollTop > 0.5) return true;
  if (dy > 0 && el.scrollTop < el.scrollHeight - el.clientHeight - 0.5) return true;
  if (dx < 0 && el.scrollLeft > 0.5) return true;
  return dx > 0 && el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5;
}

/**
 * Whether a wheel event is the student moving the view `el` shows: a pinch (ctrl / ⌘ + wheel: a
 * trackpad pinch arrives as ctrl+wheel) or a wheel that will scroll `el`. A wheel with no delta, or
 * one pushing past the end (a Magic Mouse or trackpad brushed while the cursor moves), is not.
 */
export const wheelTakesOver = (el: Parameters<typeof wheelScrolls>[0], e: { deltaX: number; deltaY: number; ctrlKey?: boolean; metaKey?: boolean }): boolean =>
  (!!(e.ctrlKey || e.metaKey) && (e.deltaX !== 0 || e.deltaY !== 0)) || wheelScrolls(el, e);

/** A wheel delta in px (Firefox reports a mouse wheel in lines, deltaMode 1; pages, deltaMode 2). */
export const wheelPx = (d: number, mode: number, page = 800): number => (mode === 1 ? d * 16 : mode === 2 ? d * page : d);

/**
 * Tells the student's scrolls from the engine's. Every programmatic write to scrollTop goes
 * through `write()`; a scroll event that lands more than `tol` px from the last written value, while
 * no glide is writing, came from somewhere else (scrollbar drag, find-in-page, middle-click, focus).
 */
export class ScrollOwner {
  private expected: number | null = null;
  private gliding = 0;
  /** When the last glide ran to its end by itself (performance.now()); -Infinity if none. */
  private settledAt = -Infinity;
  constructor(private tol = 2) {}
  write(el: { scrollTop: number }, top: number): void { this.expected = top; el.scrollTop = top; this.expected = el.scrollTop; }
  glideStart(): void { this.gliding++; }
  /** `natural`: the glide reached its target (not stopped by the student or aborted). */
  glideEnd(natural = false): void {
    this.gliding = Math.max(0, this.gliding - 1);
    if (natural && !this.gliding) this.settledAt = performance.now();
  }
  /**
   * Within `ms` after an engine glide landed by itself (§5.7): a Magic Mouse's tail momentum from
   * before the glide is not the student taking over.
   */
  justSettled(now = performance.now(), ms = 150): boolean { return !this.gliding && now - this.settledAt < ms; }
  /**
   * Call from the scroll listener. True when this scroll was not the engine's. `max` is the current
   * maximum scrollTop: landing on it when the engine's last position is now past it is the browser
   * clamping to shorter content (a region moved from below the page to beside it), not the student.
   */
  isForeign(top: number, max = Infinity): boolean {
    if (this.gliding) { this.expected = top; return false; }
    const clamped = this.expected != null && this.expected > max + this.tol && Math.abs(top - max) <= this.tol;
    const foreign = !clamped && (this.expected == null || Math.abs(top - this.expected) > this.tol);
    this.expected = top;
    return foreign;
  }
}
