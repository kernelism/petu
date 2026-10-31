// src/ink/student/BoardInk.tsx — the student's ink on the board, pinned to the drawing it was made on:
// each stroke lives in its section's own layer (`svg.desk-region-student`, a sibling of the agent's
// layers inside `.desk-region`), in the section's units, so it moves, crops, folds and zooms with that
// drawing. The Desk already keeps every non-svgboard layer's viewBox in step (crop, growth), this one too.
import { createPortal } from 'react-dom';
import { useInk, type StudentStroke } from './store';
import { StrokePath } from './StudentInkLayer';

const SVG = 'http://www.w3.org/2000/svg';

/** The open sections of the board (a folded or collapsed one takes no ink). */
export const boardSections = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.desk-region:not(.is-collapsed)')]
  .filter((el) => !el.closest('.is-collapsed, .is-folded') && el.getBoundingClientRect().height > 0);

/** A section by id (an attribute selector: ids are the model's, quoted safely). */
export const sectionEl = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`.desk-region[data-id="${id.replace(/["\\]/g, '\\$&')}"]`);

/** The section's student layer (made on first use, with the agent layer's viewBox). */
export function studentLayer(el: HTMLElement): SVGGElement {
  let svg = el.querySelector<SVGSVGElement>(':scope > svg.desk-region-student');
  if (!svg) {
    svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'desk-region-layer desk-region-student');
    svg.setAttribute('aria-hidden', 'true');
    const vb = el.querySelector(':scope > svg.desk-region-ink')?.getAttribute('viewBox') ?? el.querySelector(':scope > svg')?.getAttribute('viewBox');
    if (vb) svg.setAttribute('viewBox', vb);
    svg.appendChild(document.createElementNS(SVG, 'g'));
    el.appendChild(svg);
  }
  return svg.firstElementChild as SVGGElement;
}

/** Window px → the section's units (and its px per unit), through the student layer's own transform. */
export function toSection(el: HTMLElement): { map(x: number, y: number): { x: number; y: number }; scale: number } | null {
  const svg = studentLayer(el).ownerSVGElement;
  const m = svg?.getScreenCTM();
  if (!svg || !m) return null;
  const inv = m.inverse();
  const pt = svg.createSVGPoint();
  return {
    map: (x, y) => { pt.x = x; pt.y = y; const p = pt.matrixTransform(inv); return { x: p.x, y: p.y }; },
    scale: Math.hypot(m.a, m.b) || 1,
  };
}

/** The section a stroke drawn at these window points belongs to: the one holding most of them, else the nearest (≤ 80 px). */
export function sectionAt(pts: { x: number; y: number }[]): HTMLElement | null {
  let best: HTMLElement | null = null, bn = 0, near: HTMLElement | null = null, nd = 80;
  for (const el of boardSections()) {
    const r = el.getBoundingClientRect();
    const n = pts.filter((p) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom).length;
    if (n > bn) { bn = n; best = el; }
    for (const p of pts) {
      const d = Math.hypot(Math.max(r.left - p.x, 0, p.x - r.right), Math.max(r.top - p.y, 0, p.y - r.bottom));
      if (d < nd) { nd = d; near = el; }
    }
  }
  return best ?? near;
}

/** Renders every board stroke into its section's layer. */
export function BoardInk() {
  const { strokes } = useInk();
  const by = new Map<string, StudentStroke[]>();
  for (const s of strokes) if (s.on != null) by.set(s.on, [...(by.get(s.on) ?? []), s]);
  return (
    <>
      {[...by].map(([id, ss]) => {
        const el = sectionEl(id);
        return el ? createPortal(ss.map((s) => <StrokePath key={s.id} s={s} />), studentLayer(el), id) : null;
      })}
    </>
  );
}
