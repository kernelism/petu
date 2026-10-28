// src/agent/context/ink.ts — the student's ink on the visible page, as words the model can use.
import type { Pt } from '../../script/types';
import type { StudentStroke } from '../../ink/student/store';
import type { FigureMark } from './marks';
import type { PageGround } from './types';

const MAX_STROKES = 3;
const QUOTE = 40;

/**
 * Up to 3 of the student's strokes on `g.page`, newest first, one per line:
 * a loop (names the marks and text lines inside it), an underline (names the line above it), or a
 * stroke (its ends and the nearest mark). Undefined when there is no ink on the page.
 */
export function inkSummary(strokes: StudentStroke[], g: PageGround): string | undefined {
  const mine = strokes.filter((s) => s.page === g.page && s.points.length).slice(-MAX_STROKES).reverse();
  if (!mine.length) return undefined;
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, (a.y - b.y) * g.aspect);
  return mine.map((s) => '- ' + describe(s.points.map(([x, y]) => ({ x, y: y / g.aspect })), g, d)).join('\n');
}

function describe(pts: Pt[], g: PageGround, d: (a: Pt, b: Pt) => number): string {
  const a = pts[0], b = pts[pts.length - 1];
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += d(pts[i - 1], pts[i]);
  if (pts.length >= 4 && len > 20 && d(a, b) <= 0.15 * len) {
    const inside = [
      ...g.marks.filter((m) => inPoly(centre(m), pts)).map((m) => `${m.id}${m.label ? ` "${m.label}"` : ''}`),
      ...g.lines.filter((l) => inPoly({ x: l.rect.x + l.rect.w / 2, y: l.rect.y + l.rect.h / 2 }, pts)).map((l) => `${l.id} "${clip(l.text)}"`),
    ];
    if (inside.length) return `a loop around ${inside.slice(0, 6).join(', ')}`;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return `a loop around ${R(Math.min(...xs))},${R(Math.min(...ys))}–${R(Math.max(...xs))},${R(Math.max(...ys))} (nothing listed inside)`;
  }
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y = (a.y + b.y) / 2;
  if (straight(pts, d) && Math.abs(a.y - b.y) * g.aspect < 0.5 * (x1 - x0)) { // near-horizontal
    const under = g.lines
      .filter((l) => y >= l.rect.y + 0.5 * l.rect.h && y <= l.rect.y + l.rect.h + 1.2 * l.rect.h)
      .filter((l) => Math.min(x1, l.rect.x + l.rect.w) - Math.max(x0, l.rect.x) > 0.5 * Math.min(x1 - x0, l.rect.w))
      .sort((p, q) => Math.abs(y - (p.rect.y + p.rect.h)) - Math.abs(y - (q.rect.y + q.rect.h)))[0];
    if (under) return `an underline under ${under.id} "${clip(under.text)}"`;
  }
  let near = '', nd = Infinity;
  for (const m of g.marks) { const dist = Math.min(...pts.map((p) => d(p, centre(m)))); if (dist < nd) { nd = dist; near = m.id; } }
  for (const l of g.lines) {
    const dist = Math.min(...pts.map((p) => d(p, { x: Math.max(l.rect.x, Math.min(p.x, l.rect.x + l.rect.w)), y: Math.max(l.rect.y, Math.min(p.y, l.rect.y + l.rect.h)) })));
    if (dist < nd) { nd = dist; near = `${l.id} "${clip(l.text)}"`; }
  }
  return `a stroke from ${R(a.x)},${R(a.y)} to ${R(b.x)},${R(b.y)}${near ? ` near ${near}` : ''}`;
}

const R = Math.round;
const clip = (s: string) => (s.length > QUOTE ? `${s.slice(0, QUOTE - 1).trimEnd()}…` : s);
function centre(m: FigureMark): Pt {
  if (m.kind === 'dot') return m.at;
  if ('from' in m) return { x: (m.from.x + m.to.x) / 2, y: (m.from.y + m.to.y) / 2 };
  return { x: m.rect.x + m.rect.w / 2, y: m.rect.y + m.rect.h / 2 };
}
/** Max deviation from the chord under 10% of its length. */
function straight(pts: Pt[], d: (a: Pt, b: Pt) => number): boolean {
  const a = pts[0], b = pts[pts.length - 1];
  const L = d(a, b);
  if (L < 15) return false;
  return pts.every((p) => {
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
    return d(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }) < 0.1 * L;
  });
}
function inPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
