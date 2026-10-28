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
    const y = anchor.rect.y + anchor.rect.h + span + pad.t;
    const op = spec.op ? { x: anchor.body.x + Math.min(w, anchor.body.w) / 2, y: anchor.rect.y + anchor.rect.h + span / 2, glyph: spec.op } : undefined;
    return at(Math.max(s.margin + pad.l, anchor.body.x), y, op);
  }
  return at(s.margin + pad.l, below() + pad.t);
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
