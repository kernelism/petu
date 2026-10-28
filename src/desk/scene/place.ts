// src/desk/scene/place.ts
/**
 * Placement by relation in a scene (spec "Board v2" 1). Pure.
 *
 * The model says what a thing explains (right of it, under it, beside it, near it, annotating it);
 * the engine picks where: candidates around the anchor at a gap that varies a little per element
 * (seeded by its id, so a replay is identical), aligned where alignment helps reading (a thing below
 * starts at its anchor's left edge, a thing beside it shares its centre line), and scored by overlap
 * with everything already claimed, distance from the anchor and how far the camera would travel. A
 * light constraint solver: if every candidate overlaps, the ring of candidates steps outward.
 */
export type Box = { x: number; y: number; w: number; h: number };
export type Rel = 'right' | 'left' | 'above' | 'below' | 'beside' | 'near';
export const RELS: readonly Rel[] = ['right', 'left', 'above', 'below', 'beside', 'near'];

export type PlaceOpts = {
  /** The base gap between things (world units): the board's type sets it. */
  gap: number;
  /** Seeds the per-element variation. */
  seed: string;
  /** What the student sees now: candidates inside it are preferred (less camera travel). */
  view?: Box;
};

/** A deterministic number in [0, 1) from a string. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const area = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Candidate top-left corners for a w × h box on one side of `a`, `d` away, with cross-axis alignments. */
function side(dir: 'right' | 'left' | 'above' | 'below', a: Box, w: number, h: number, d: number, j: number): { x: number; y: number; pref: number }[] {
  const out: { x: number; y: number; pref: number }[] = [];
  if (dir === 'right' || dir === 'left') {
    const x = dir === 'right' ? a.x + a.w + d : a.x - d - w;
    // Centre line first (a row reads across), then top- and bottom-aligned, then a little off (organic).
    const cy = a.y + a.h / 2 - h / 2;
    out.push({ x, y: cy + j * h * 0.18, pref: 0 }, { x, y: a.y, pref: 0.4 }, { x, y: a.y + a.h - h, pref: 0.4 }, { x, y: cy - h * 0.7, pref: 0.8 }, { x, y: cy + h * 0.7, pref: 0.8 });
  } else {
    const y = dir === 'below' ? a.y + a.h + d : a.y - d - h;
    // Left edges aligned first (a column reads down), then centred, then offset a little.
    out.push({ x: a.x, y, pref: 0 }, { x: a.x + a.w / 2 - w / 2, y, pref: 0.3 }, { x: a.x + a.w - w, y, pref: 0.5 }, { x: a.x + (0.25 + 0.2 * j) * Math.max(a.w, w), y, pref: 0.6 }, { x: a.x - w * 0.35, y, pref: 0.8 });
  }
  return out;
}

const ORDER: Record<Rel, ('right' | 'left' | 'above' | 'below')[]> = {
  right: ['right'], left: ['left'], above: ['above'], below: ['below'],
  beside: ['right', 'left'], near: ['right', 'below', 'left', 'above'],
};

/**
 * Where a w × h box goes, relative to `anchor` (or after `last`, the most recent thing, when there is
 * no anchor: the explanation flows on from where it is). `taken`: every claimed rect (the anchor's
 * own included). Returns the box's top-left rect.
 */
export function placeRel(w: number, h: number, rel: Rel | null, anchor: Box | null, taken: Box[], o: PlaceOpts): Box {
  const j = hash01(o.seed) * 2 - 1;
  const gap = o.gap * (1 + 0.28 * hash01(`${o.seed}:g`));
  if (!anchor) {
    const ext = taken.length ? taken.reduce((u, b) => ({ x: Math.min(u.x, b.x), y: Math.min(u.y, b.y), w: 0, h: 0 }), { x: Infinity, y: Infinity, w: 0, h: 0 }) : null;
    // The first thing in an empty scene sits a little in from its top-left (room to grow every way).
    if (!ext || !taken.length) return { x: o.gap * 2.2, y: o.gap * 2.6, w, h };
    const last = taken[taken.length - 1];
    return placeRel(w, h, rel ?? 'near', last, taken, o);
  }
  const dirs = ORDER[rel ?? 'near'];
  const clear = gap * 0.45;
  let best = null as { b: Box; cost: number } | null;
  for (let ring = 0; ring < 14; ring++) {
    const d = gap * (1 + ring * 0.85);
    for (let k = 0; k < dirs.length; k++) {
      for (const c of side(dirs[k], anchor, w, h, d, j)) {
        const b = { x: c.x, y: c.y, w, h };
        const hit = taken.reduce((s, t) => s + area(grow(b, clear), t), 0);
        const ac = centre(anchor), bc = centre(b);
        const dist = Math.hypot(bc.x - ac.x, bc.y - ac.y) / Math.max(1, o.gap * 10);
        // Out of view costs a little (the camera will travel), never a lot: the scene may grow.
        const out = o.view ? 1 - area(b, o.view) / Math.max(1, w * h) : 0;
        const cost = (hit > 0 ? 1000 + hit / Math.max(1, w * h) * 100 : 0) + c.pref + k * 0.6 + dist * 0.4 + out * 0.5 + ring * 0.3;
        if (!best || cost < best.cost) best = { b, cost };
      }
    }
    if (best && best.cost < 1000) return best.b;
  }
  return best ? best.b : { x: anchor.x + anchor.w + gap, y: anchor.y, w, h };
}

/** Whether two boxes overlap (with `pad` air). */
export const overlaps = (a: Box, b: Box, pad = 0) => area(grow(a, pad), b) > 0;
