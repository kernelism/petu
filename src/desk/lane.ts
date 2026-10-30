// src/desk/lane.ts — layout C, the anchored lane (spec layout-ux-research §5.2): pure placement maths.
/**
 * The lane is a paper margin joined to the page, on the page's own scroll. Each answer's drawings are
 * one group (its question head and its sections, stacked) whose top sits level with the passage it
 * explains; a group whose slot is taken stacks downward with a LANE_GAP gap. While the answer plays
 * the group is sticky (it stays in view beside whatever page the answer walks to); at its end it
 * docks beside its main anchor, moving as little as it can. All numbers are content px (the scroll
 * content's y) unless named otherwise.
 */

/** Between groups that would overlap. */
export const LANE_GAP = 24;
/** The lane's inner padding (left and right of its items). */
export const LANE_PAD = 24;
/** A leader runs at most this far vertically; past it the anchor is too far to point at. */
export const LEADER_MAX = 120;
/** A leader never meets its item closer than this to the item's top or bottom edge. */
export const LEADER_INSET = 18;
/** A folded answer card's height. */
export const FOLDED_H = 36;

export type Span = { top: number; h: number };

/**
 * Places groups in order: each at its wanted top, or the first top below it where it overlaps no group
 * placed before it (with LANE_GAP air). Earlier groups never move for later ones.
 */
export function packLane(items: { want: number; h: number }[]): number[] {
  const placed: Span[] = [];
  return items.map(({ want, h }) => {
    let top = Math.max(0, want);
    // Each collision pushes the group under the one it hits; repeat until it fits a gap.
    for (let moved = true; moved;) {
      moved = false;
      for (const p of placed) {
        if (top < p.top + p.h + LANE_GAP && p.top < top + h + LANE_GAP) { top = p.top + p.h + LANE_GAP; moved = true; }
      }
    }
    placed.push({ top, h });
    return top;
  });
}

/** Where a new group wants its top: its head sits just above the anchor, so the drawing starts level with it. */
export const wantFor = (anchorY: number, headH: number) => Math.max(0, anchorY - headH - 8);

/**
 * Docking at the answer's end (spec §5.2 rule 5): the group stays where it is on screen (`now`, its
 * content top this frame) if the anchor still falls inside it, else it moves the least so it does.
 */
export function dockTop(now: number, h: number, anchorY: number, headH: number): number {
  const lo = anchorY - h + LEADER_INSET, hi = anchorY - headH - 8;
  if (hi < lo) return Math.max(0, anchorY - headH - 8);
  return Math.max(0, Math.min(hi, Math.max(lo, now)));
}

/**
 * A leader from the page edge at `y0` (the anchor) to an item spanning `item` (top, h), `w` px to the
 * right: a short S (or a straight line when level), 1 px, with a dot on the page edge. Null when the
 * item is too far from the anchor to point at.
 */
export function leaderPath(y0: number, item: Span, w: number, headH = 0): { d: string; y1: number } | null {
  const lo = item.top + headH + LEADER_INSET, hi = item.top + item.h - LEADER_INSET;
  const y1 = hi < lo ? item.top + item.h / 2 : Math.max(lo, Math.min(hi, y0));
  if (Math.abs(y1 - y0) > LEADER_MAX) return null;
  if (Math.abs(y1 - y0) < 0.5) return { d: `M0 ${y0.toFixed(1)}H${w.toFixed(1)}`, y1 };
  const k = w * 0.55;
  return { d: `M0 ${y0.toFixed(1)}C${k.toFixed(1)} ${y0.toFixed(1)} ${(w - k).toFixed(1)} ${y1.toFixed(1)} ${w.toFixed(1)} ${y1.toFixed(1)}`, y1 };
}

/**
 * The sticky insets for a live group `h` px tall in a window `H` tall, with `top` (the chrome) and
 * `bottom` (the dock) kept clear: it sticks under the chrome; a group taller than the band keeps its
 * newest (bottom) part in view instead, or, given `pen` (the part being drawn: px from the item's top),
 * that part, moving least from `prev` (the top inset it had).
 */
export function stickyInsets(h: number, H: number, top: number, bottom: number, pen?: Span | null, prev?: number | null): { top: number; bottom: number } {
  const band = H - top - bottom;
  if (h <= band) return { top, bottom };
  const lo = H - bottom - h;
  if (!pen) return { top: lo, bottom };
  let t = prev ?? lo;
  if (pen.h >= band || t + pen.top < top) t = top - pen.top;
  else if (t + pen.top + pen.h > H - bottom) t = H - bottom - pen.h - pen.top;
  t = Math.max(lo, Math.min(top, t));
  // Both insets agree (the item's bottom sits where its top puts it), so neither wins over the other.
  return { top: t, bottom: H - t - h };
}
