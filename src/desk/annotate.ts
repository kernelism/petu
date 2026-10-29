// src/desk/annotate.ts — where a short note goes on a page: beside what it annotates, never over the
// page's own text or figures, with a leader line when it has to sit apart. Pure (target space).
import type { SPt, SRect } from '../geometry/space';

export type NotePlace = { box: SRect; /** from the note's edge to the target's edge; absent when they touch */ leader?: [SPt, SPt]; /** lower is better: distance, plus what its leader crosses */ score: number };

const inter = (a: SRect, b: SRect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const grow = (r: SRect, d: number): SRect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const inside = (r: SRect, b: SRect) => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h;
/** The point of `r` nearest `p`. */
const nearestOn = (r: SRect, p: SPt): SPt => ({ x: Math.max(r.x, Math.min(p.x, r.x + r.w)), y: Math.max(r.y, Math.min(p.y, r.y + r.h)) });
/** Does segment pq cross rect r (Liang–Barsky)? */
function crosses(p: SPt, q: SPt, r: SRect): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (pp: number, qq: number) => { if (pp === 0) return qq >= 0; const t = qq / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
  return clip(-dx, p.x - r.x) && clip(dx, r.x + r.w - p.x) && clip(-dy, p.y - r.y) && clip(dy, r.y + r.h - p.y) && t0 < t1;
}

/**
 * Places a w × h note for `target`: candidates at growing distances in eight directions around it
 * (right and left first: a note reads beside a symbol), plus the page margins at the target's height.
 * A candidate that touches any obstacle (text, figures, earlier ink; `gap` of air) or leaves `bounds`
 * is never taken; among the rest the nearest wins, lightly penalised for a leader that crosses
 * obstacles. null: no free spot (the caller skips the note rather than cover the page).
 */
export function placeNote(target: SRect, w: number, h: number, obstacles: SRect[], bounds: SRect, gap: number): NotePlace | null {
  const tc = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
  // What it annotates is not an obstacle: anything mostly inside the target (its own text), or a
  // region around it (the figure or chart it sits in: the note may go in that figure's empty space).
  const holds = (o: SRect) => tc.x >= o.x && tc.x <= o.x + o.w && tc.y >= o.y && tc.y <= o.y + o.h && o.h > 3 * Math.max(target.h, h);
  const solid = obstacles.filter((o) => !holds(o) && inter(o, grow(target, 1)) < 0.8 * o.w * o.h);
  const free = (r: SRect) => inside(r, bounds) && !solid.some((o) => inter(grow(r, gap), o) > 0) && inter(grow(r, gap), target) === 0;
  const cands: { r: SRect; d: number }[] = [];
  const steps = [0, 1, 2, 3, 5, 8, 12, 18];
  for (const s of steps) {
    const off = gap * 2 + s * Math.max(h, gap * 2);
    const midY = tc.y - h / 2, midX = tc.x - w / 2;
    const place = [
      { x: target.x + target.w + off, y: midY }, // right
      { x: target.x - off - w, y: midY }, // left
      { x: midX, y: target.y - off - h }, // above
      { x: midX, y: target.y + target.h + off }, // below
      { x: target.x + target.w + off, y: target.y - off - h }, // above right
      { x: target.x + target.w + off, y: target.y + target.h + off }, // below right
      { x: target.x - off - w, y: target.y - off - h }, // above left
      { x: target.x - off - w, y: target.y + target.h + off }, // below left
    ];
    // Above and below, also flush with the target's left or right edge (a note over a line of an
    // equation reads with it, and fits between the page's lines where a centred one would not).
    for (const y of [target.y - off - h, target.y + target.h + off]) place.push({ x: target.x, y }, { x: target.x + target.w - w, y });
    place.forEach((p, i) => cands.push({ r: { x: p.x, y: p.y, w, h }, d: off + (i < 2 ? 0 : i < 4 || i >= 8 ? h * 0.5 : h) }));
  }
  // The margins: at the target's height, in the free column on either side of everything.
  const content = solid.reduce((u, o) => ({ x0: Math.min(u.x0, o.x), x1: Math.max(u.x1, o.x + o.w) }), { x0: target.x, x1: target.x + target.w });
  for (const x of [content.x1 + gap * 2, content.x0 - gap * 2 - w]) {
    for (const dy of [0, -h * 1.5, h * 1.5, -h * 3, h * 3]) cands.push({ r: { x, y: tc.y - h / 2 + dy, w, h }, d: Math.abs(x + w / 2 - tc.x) + Math.abs(dy) });
  }
  let best: { r: SRect; score: number } | null = null;
  for (const c of cands) {
    if (!free(c.r)) continue;
    const a = nearestOn(c.r, tc), b = nearestOn(target, a);
    const crossed = solid.filter((o) => crosses(a, b, o)).length;
    const score = c.d + crossed * 12 * h; // a leader through the page's words reads as crossing them out
    if (!best || score < best.score) best = { r: c.r, score };
  }
  if (!best) return null;
  const a = nearestOn(best.r, tc), b = nearestOn(target, a);
  const far = Math.hypot(a.x - b.x, a.y - b.y) > gap * 3;
  return { box: best.r, score: best.score, ...(far ? { leader: [a, b] as [SPt, SPt] } : {}) };
}
