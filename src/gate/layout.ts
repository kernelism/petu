// src/gate/layout.ts — layout checks on drawn board elements: text colliding with text or strokes,
// kit blocks overlapping, elements outside the section, unreadable text, bar labels wider than their
// bars, ref labels far from their referent. Pure geometry over element boxes and strokes in region
// units (x 0–1000 across a section); offline they come from the eval's recorded registry (what the
// engine laid out in the browser), live they would come from the gate's offscreen layout.

export type Rect = { x: number; y: number; w: number; h: number };
export type P = { x: number; y: number };
export type El = {
  id: string; kind: string; region?: string; page?: number;
  bbox: Rect; boxes: Rect[]; strokes: P[][];
  /** Text boxes (labels, written text) — what must stay readable. */
  text: Rect[];
  /** The element this one annotates (a ref label's referent, a box framing a kit part). */
  annotates?: string;
  /** Charts drawn on shared axes (a plot or scatter with axes=…): one group, overlays by design. */
  group?: string;
  /** Bars: their labels (for the width estimate). */
  barLabels?: string[];
};

/** Board px per region unit in the eval's 1440×900 split (a 666px-wide board for 1000 units). */
export const PX_PER_UNIT = 0.666;
/** Kit label type size, px (approx.: the kit sizes labels from the slide's body text). */
export const LABEL_PX = 11;
export const MIN_TEXT_PX = 10;

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
export function inter(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const pad = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const shrink = (r: Rect, fx: number, fy: number): Rect => ({ x: r.x + r.w * fx, y: r.y + r.h * fy, w: r.w * (1 - 2 * fx), h: r.h * (1 - 2 * fy) });

/** Does segment pq cross rect r (Liang–Barsky)? */
export function segHitsRect(p: P, q: P, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  const clip = (pp: number, qq: number) => { if (pp === 0) return qq >= 0; const t = qq / pp; if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
  return clip(-dx, p.x - r.x) && clip(dx, r.x + r.w - p.x) && clip(-dy, p.y - r.y) && clip(dy, r.y + r.h - p.y) && t0 <= t1;
}
const strokeHits = (s: P[], r: Rect) => s.some((p, i) => i > 0 && segHitsRect(s[i - 1], p, r));

export type LayoutFlag = { kind: 'text-overlap' | 'text-on-stroke' | 'block-overlap' | 'outside' | 'small-text' | 'bar-labels' | 'label-far' | 'covers-page-text' | 'lift-outside'; detail: string; ids: string[] };

const isKit = (e: El) => e.kind.startsWith('kit-');
const textEstimatePx = (s: string, px: number) => s.length * px * 0.55;

/**
 * Checks the elements new in this beat against everything on the same section so far (including
 * each other). Text gets a small margin; strokes must not cross the inner 70% of a text box.
 */
export function checkLayout(added: El[], before: El[]): LayoutFlag[] {
  const out: LayoutFlag[] = [];
  const all = [...before, ...added];
  const seen = new Set<string>();
  const once = (f: LayoutFlag) => { const k = `${f.kind}|${[...f.ids].sort().join(',')}`; if (!seen.has(k)) { seen.add(k); out.push(f); } };
  for (const e of added) {
    if (e.region == null) continue;
    const others = all.filter((o) => o !== e && o.region === e.region);
    // Outside the section (x is the section's full width; y grows with tall content).
    if (e.bbox.x < -15 || e.bbox.x + e.bbox.w > 1015) once({ kind: 'outside', detail: `${e.kind} ${e.id} spans x ${Math.round(e.bbox.x)}–${Math.round(e.bbox.x + e.bbox.w)} of 0–1000`, ids: [e.id] });
    // A lifted page region stays inside its section (the resolver fits it into 1000 × 700).
    if (e.kind === 'lift' && (e.bbox.x < -1 || e.bbox.y < -1 || e.bbox.x + e.bbox.w > 1001 || e.bbox.y + e.bbox.h > 701)) once({ kind: 'lift-outside', detail: `lift ${e.id} spans ${Math.round(e.bbox.x)},${Math.round(e.bbox.y)}–${Math.round(e.bbox.x + e.bbox.w)},${Math.round(e.bbox.y + e.bbox.h)} of 1000 × 700`, ids: [e.id] });
    for (const t of e.text) {
      if (t.h * PX_PER_UNIT < MIN_TEXT_PX) once({ kind: 'small-text', detail: `${e.kind} ${e.id} text ${Math.round(t.h * PX_PER_UNIT)}px tall`, ids: [e.id] });
    }
    for (const o of others) {
      if (o.annotates === e.id || e.annotates === o.id) continue;
      if (e.group != null && e.group === o.group) continue;
      // Text against text (and kit blocks, which are mostly text): a 4-unit margin each.
      const eText = isKit(e) ? [e.bbox] : e.text, oText = isKit(o) ? [o.bbox] : o.text;
      if (isKit(e) && isKit(o)) {
        if (inter(e.bbox, o.bbox) > 0) once({ kind: 'block-overlap', detail: `kit ${e.id} overlaps kit ${o.id}`, ids: [e.id, o.id] });
        continue;
      }
      if (eText.some((a) => oText.some((b) => inter(pad(a, 4), pad(b, 4)) > 0))) once({ kind: 'text-overlap', detail: `text of ${e.kind} ${e.id} runs into ${o.kind} ${o.id}`, ids: [e.id, o.id] });
      // Strokes through text: either direction (a new stroke through old text, new text on an old stroke).
      const through = (txt: Rect[], s: P[][]) => txt.some((r) => s.some((st) => strokeHits(st, shrink(r, 0.15, 0.15))));
      if (!isKit(o) && through(e.text, o.strokes)) once({ kind: 'text-on-stroke', detail: `${o.kind} ${o.id} crosses the text of ${e.kind} ${e.id}`, ids: [e.id, o.id] });
      if (!isKit(e) && through(o.text, e.strokes)) once({ kind: 'text-on-stroke', detail: `${e.kind} ${e.id} crosses the text of ${o.kind} ${o.id}`, ids: [e.id, o.id] });
    }
    // Bar labels wider than a bar's slot (approx.: estimated text width at the kit label size).
    if (e.barLabels?.length) {
      const pitch = e.bbox.w / e.barLabels.length;
      const wide = e.barLabels.filter((l) => textEstimatePx(l, LABEL_PX) / PX_PER_UNIT > pitch - 2);
      if (wide.length) once({ kind: 'bar-labels', detail: `bars ${e.id}: label${wide.length > 1 ? 's' : ''} ${wide.map((w) => `"${w}"`).join(', ')} wider than a bar slot (~${Math.round(pitch)} units)`, ids: [e.id] });
    }
    // A ref label far from what it labels.
    if (e.kind === 'label' && e.annotates) {
      const ref = all.find((o) => o.id === e.annotates);
      if (ref && e.text[0]) {
        const r = ref.bbox, t = e.text[0];
        const dx = Math.max(0, r.x - (t.x + t.w), t.x - (r.x + r.w)), dy = Math.max(0, r.y - (t.y + t.h), t.y - (r.y + r.h));
        if (Math.hypot(dx, dy) > 60) once({ kind: 'label-far', detail: `label ${e.id} sits ${Math.round(Math.hypot(dx, dy))} units from ${ref.id}`, ids: [e.id, ref.id] });
      }
    }
  }
  return out;
}

/**
 * Page annotations (notes, labels, point labels written on a page) must never cover the page's own
 * text: each text box, its inner 70%, against the page's text lines (`lines(page)`: target space,
 * x 0–1000, y scaled by the page's aspect, as the recorded registry is).
 */
export function checkPageText(added: El[], lines: (page: number) => Rect[] | undefined): LayoutFlag[] {
  const out: LayoutFlag[] = [];
  for (const e of added) {
    if (e.page == null || !e.text.length) continue;
    const ls = lines(e.page);
    if (!ls?.length) continue;
    const hit = ls.filter((l) => e.text.some((t) => inter(shrink(t, 0.15, 0.15), l) > 0));
    if (hit.length) out.push({ kind: 'covers-page-text', detail: `${e.kind} ${e.id} covers ${hit.length} line${hit.length > 1 ? 's' : ''} of page ${e.page}'s text`, ids: [e.id] });
  }
  return out;
}

export const _test = { area, pad, shrink };
