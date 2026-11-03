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
 * placed before it (with LANE_GAP air). Earlier groups never move for later ones, unless the lane ends:
 * nothing may sit below `end` (the lowest point the window can show above the dock), so a group that
 * would run past it rises, and the groups above it rise to keep the gap. Past it the live group's
 * sticky inset pulled it up over the docked one (a follow-up on the last page drew over the answer before).
 */
export function packLane(items: { want: number; h: number }[], end = Infinity): number[] {
  const placed: Span[] = [];
  const tops = items.map(({ want, h }) => {
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
  // Bottom up: each group ends above `end`, or above the next one down with LANE_GAP air (never above 0;
  // a lane holding more than fits runs past its end instead).
  const order = tops.map((_, i) => i).sort((a, b) => tops[b] - tops[a]);
  let floor = end;
  for (const i of order) { tops[i] = Math.max(0, Math.min(tops[i], floor - items[i].h)); floor = tops[i] - LANE_GAP; }
  let below = -Infinity;
  for (const i of order.reverse()) { tops[i] = Math.max(tops[i], below); below = tops[i] + items[i].h + LANE_GAP; }
  return tops;
}

/** Where a new group wants its top: its head sits just above the anchor, so the drawing starts level with it. */
export const wantFor = (anchorY: number, headH: number) => Math.max(0, anchorY - headH - 8);

/**
 * Where a group docks from (sheet px): its top this frame, raised when its bottom would fall under the
 * dock (`viewTop` the scroll top, `H` the window, `bottom` the dock's inset): what was drawn last stays
 * in view at the answer's end, even for a group taller than the band (its first rows then sit above the
 * window, a scroll away).
 */
export function dockNow(now: number, h: number, viewTop: number, H: number, bottom: number): number {
  return Math.min(now, viewTop + H - bottom - h);
}

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
 * Where a group's leader may start, in order of preference: the playing answer's latest page mark,
 * then the group's anchor only when that anchor is a page mark (`marked`). A drawing whose answer never
 * marked a page (asked on a title page, say) sits in the lane with no leader: never one to the view.
 */
export function leaderFrom(liveMark: number | null, anchor: number, marked: boolean): number[] {
  return [...(liveMark != null ? [liveMark] : []), ...(marked ? [anchor] : [])];
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

/**
 * Sticky insets (window px) as the sheet's own px under the overview zoom `z` (the sheet scaled about
 * its top; `st` the scroller's raw scrollTop, `H` the window height). Sticky runs in the unscaled
 * layout against the raw scrollTop, so a group stuck at `top` px would show at top·z + st·(z − 1).
 */
export function zoomedInsets(ins: { top: number; bottom: number }, H: number, st: number, z: number): { top: number; bottom: number } {
  if (!(z > 0) || Math.abs(z - 1) < 1e-4) return { ...ins };
  return { top: (ins.top - st * (z - 1)) / z, bottom: st + H - (H - ins.bottom + st) / z };
}

/**
 * The part of the lane (sheet px) that shows in the window under the overview zoom `z` and pan `panX`
 * (the sheet scaled about W/2, slid by panX). Zoomed in, the lane's far side leaves the window: the
 * lane lays its drawings out in this part only, so a drawing is never cut by the window's edge
 * (founder 2026-10-30: "image B" cut off at 125%). Never narrower than half the lane (a lane panned
 * almost out of view keeps a usable width; the student panned away from it).
 */
export function visibleLane(lane: { x: number; w: number }, W: number, z: number, panX: number, edge = 12): { x: number; w: number } {
  if (!(z > 0) || (Math.abs(z - 1) < 1e-4 && Math.abs(panX) < 0.5)) return { x: lane.x, w: lane.w };
  const sx = (x: number) => W / 2 + panX + (x - W / 2) * z;
  const a = Math.max(edge, sx(lane.x)), b = Math.min(W - edge, sx(lane.x + lane.w));
  const w = Math.min(lane.w, Math.max(lane.w / 2, (b - a) / z));
  const x = Math.min(lane.x + lane.w - w, Math.max(lane.x, lane.x + (a - sx(lane.x)) / z));
  return { x, w };
}

/**
 * The walk (an svg board that explains several pages): `pages` holds the page each of the answer's svg
 * groups explains, in draw order (null: no page mark since it began), the live drawing showing those from
 * `from` on. A page mark on `page` gives every unplaced group from `from` on that page (`placed`). When
 * the drawing's earlier groups explain another page, they stay behind: `runs` (consecutive groups on one
 * page each) become slices beside their pages and the live drawing shows from `at` on. Null runs: it stays whole.
 */
export function walkSplit(pages: readonly (number | null)[], from: number, page: number): { placed: number[]; runs: number[][] | null; at: number } {
  const placed: number[] = [];
  for (let i = from; i < pages.length; i++) if (pages[i] == null) placed.push(i);
  const at = placed.length ? placed[0] : pages.length;
  if (!placed.length) return { placed, runs: null, at: from };
  const done: number[] = [];
  for (let i = from; i < at; i++) if (pages[i] != null) done.push(i);
  if (!done.length || done.every((i) => pages[i] === page)) return { placed, runs: null, at: from };
  const runs: number[][] = [];
  for (const i of done) { const last = runs[runs.length - 1]; if (last && pages[last[0]] === pages[i]) last.push(i); else runs.push([i]); }
  return { placed, runs, at };
}

/**
 * The live group's sticky top (window px), moved down below any docked card that would sit under it:
 * a docked answer and the playing one anchored at the same passage otherwise overprint (founder
 * 2026-10-31: answer 11's head drawn over answer 10's folded card). `blockers` are the docked items'
 * window spans; the group clears each one it would cross, by `gap`, as far down as the band allows
 * (never past `maxTop`, where its newest part would leave the window).
 */
export function clearOfDocked(top: number, h: number, blockers: readonly Span[], maxTop: number, gap = 8): number {
  let t = top;
  for (let i = 0; i < 8; i++) {
    const hit = blockers.filter((b) => b.top < t + h && b.top + b.h > t);
    if (!hit.length) break;
    const next = Math.max(...hit.map((b) => b.top + b.h)) + gap;
    if (next > maxTop) return Math.max(top, maxTop);
    t = next;
  }
  return t;
}

/**
 * Whether the live group (`live`, window px) covers a docked one (`docked`): they overlap on screen by
 * more than `min` px. The docked one then hides until they part (clearOfDocked could not move the live
 * group off it): a follow-up that scrolls back to an earlier answer's page draws on top of that answer's
 * board otherwise (eval fu D1, draw D1: new bars printed over the docked 'Competitive inhibition' board).
 */
export function covers(live: Span, docked: Span, min = 8): boolean {
  return Math.min(live.top + live.h, docked.top + docked.h) - Math.max(live.top, docked.top) > min;
}
