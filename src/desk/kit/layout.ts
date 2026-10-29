// src/desk/kit/layout.ts
/**
 * Where kit blocks go in a board section (section units: x 0–1000, y down). Pure.
 *
 * A block is its body (the cells, the bars, the plot) plus room around it for labels: `pad` is how
 * far its labels reach left, above, right and below the body. Relative placement aligns bodies, so
 * "patch ⊛ kernel = output" share one centre line whatever their row counts, and a block placed
 * below starts at the left edge of the body above it.
 */
export type Box = { x: number; y: number; w: number; h: number };
export type Pad = { l: number; t: number; r: number; b: number };
export type Placed = { body: Box; rect: Box; op?: { x: number; y: number; glyph: string } };
export type PlaceSpec = { right?: string; below?: string; op?: string; at?: { x: number; y: number } };
/** Spacing (section units), from the board's type: see metrics() in kit.ts. */
export type Spacing = { gap: number; opW: number; margin: number; top: number; width: number };

export const rectOf = (body: Box, p: Pad): Box => ({ x: body.x - p.l, y: body.y - p.t, w: p.l + body.w + p.r, h: p.t + body.h + p.b });
const bottomOf = (bs: Placed[]) => Math.max(...bs.map((b) => b.rect.y + b.rect.h));

/**
 * Places a block of body size w × h with label room `pad`.
 * - right=A: right of A's rect (one gap, or room for the op glyph), bodies centred on one line. If it
 *   would run past the section's right margin, it wraps under everything placed so far, at the left
 *   margin (the glyph then leads the new line).
 * - below=A: under A's rect, body left edges aligned (the glyph sits in the gap, centred).
 * - at: the body's top-left.
 * - neither: under everything in the section (at the top margin if it is the first), at the left margin.
 * Unknown anchors fall back to the default.
 */
export function place(w: number, h: number, pad: Pad, spec: PlaceSpec, anchor: Placed | undefined, region: Placed[], s: Spacing): Placed {
  const at = (x: number, y: number, op?: Placed['op']): Placed => {
    const body = { x, y, w, h };
    return { body, rect: rectOf(body, pad), ...(op ? { op } : {}) };
  };
  const below = () => (region.length ? bottomOf(region) + s.gap : s.top);
  if (spec.at) return at(spec.at.x, spec.at.y);
  if (anchor && spec.right) {
    const span = spec.op ? s.opW + s.gap : s.gap;
    const x = anchor.rect.x + anchor.rect.w + span + pad.l;
    const cy = anchor.body.y + anchor.body.h / 2;
    if (x + w + pad.r <= s.width - s.margin) {
      const op = spec.op ? { x: anchor.rect.x + anchor.rect.w + span / 2, y: cy, glyph: spec.op } : undefined;
      return at(x, cy - h / 2, op);
    }
    // Wrap: a new line under everything, the glyph leading it.
    const lead = spec.op ? s.opW + s.gap / 2 : 0;
    const y = below() + pad.t;
    const op = spec.op ? { x: s.margin + s.opW / 2, y: y + h / 2, glyph: spec.op } : undefined;
    return at(s.margin + lead + pad.l, y, op);
  }
  if (anchor && spec.below) {
    const span = spec.op ? s.opW + s.gap : s.gap;
    // Under the anchor, and under anything placed since that sits in the way (a calc line under it).
    const x0 = Math.max(s.margin + pad.l, anchor.body.x) - pad.l, x1 = x0 + pad.l + w + pad.r;
    const inWay = region.filter((r) => r !== anchor && r.rect.y >= anchor.rect.y + anchor.rect.h - 1 && r.rect.x < x1 && r.rect.x + r.rect.w > x0);
    const floor = Math.max(anchor.rect.y + anchor.rect.h, ...inWay.map((r) => r.rect.y + r.rect.h));
    const y = floor + span + pad.t;
    const op = spec.op ? { x: anchor.body.x + Math.min(w, anchor.body.w) / 2, y: anchor.rect.y + anchor.rect.h + span / 2, glyph: spec.op } : undefined;
    return at(Math.max(s.margin + pad.l, anchor.body.x), y, op);
  }
  return at(s.margin + pad.l, below() + pad.t);
}

/**
 * A placed block moved down, as a whole, until it overlaps none of `ink` (other ink in a plain
 * section: a hand-drawn figure, a note, a label); the alignment `place` chose is kept across. Pure.
 */
export function clearDown(p: Placed, ink: Box[], gap: number): Placed {
  let dy = 0;
  for (let i = 0; i < 24; i++) {
    const r = { ...p.rect, y: p.rect.y + dy };
    const hit = ink.filter((o) => o.x < r.x + r.w && r.x < o.x + o.w && o.y < r.y + r.h && r.y < o.y + o.h);
    if (!hit.length) break;
    dy = Math.max(...hit.map((o) => o.y + o.h)) + gap - p.rect.y;
  }
  if (dy <= 0) return p;
  const sh = (b: Box) => ({ ...b, y: b.y + dy });
  return { body: sh(p.body), rect: sh(p.rect), ...(p.op ? { op: { ...p.op, y: p.op.y + dy } } : {}) };
}

/**
 * Splits pieces of a calculation into lines no wider than `maxW`, breaking only between pieces
 * (each piece carries its own trailing " + "). `width(s)` measures a piece.
 */
export function wrapPieces(pieces: string[], maxW: number, width: (s: string) => number): string[][] {
  const lines: string[][] = [[]];
  let cur = 0;
  for (const p of pieces) {
    const w = width(p);
    const line = lines[lines.length - 1];
    if (line.length && cur + w > maxW) { lines.push([p]); cur = w; } else { line.push(p); cur += w; }
  }
  return lines;
}
