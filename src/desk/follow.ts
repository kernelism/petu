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

/** Keys that scroll the page (when not typing). */
export const isScrollKey = (e: { key: string; target?: EventTarget | null }) => {
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ''));
  return !typing && SCROLL_KEYS.has(e.key);
};

/**
 * Tells the student's scrolls from the engine's. Every programmatic write to scrollTop goes
 * through `write()`; a scroll event that lands more than `tol` px from the last written value, while
 * no glide is writing, came from somewhere else (scrollbar drag, find-in-page, middle-click, focus).
 */
export class ScrollOwner {
  private expected: number | null = null;
  private gliding = 0;
  constructor(private tol = 2) {}
  write(el: { scrollTop: number }, top: number): void { this.expected = top; el.scrollTop = top; this.expected = el.scrollTop; }
  glideStart(): void { this.gliding++; }
  glideEnd(): void { this.gliding = Math.max(0, this.gliding - 1); }
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
