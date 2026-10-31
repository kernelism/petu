// src/session/marks.ts — a saved question's marks on the pages (highlights, the tutor's ink, the past
// marks M shows), taken off the slides and put back as they were. Page model units, so they land right
// at any zoom or window size. The student's own ink is a separate layer and is never touched.
import type { PageLayers } from '../pdf/viewerApi';

type Layer = { nodes: Node[]; past: Element | null };
/** Per page: each layer's children and its `.petu-past` sibling (retireOut parks earlier answers' marks there). */
export type MarksSnapshot = Map<number, { highlight: Layer; agent: Layer }>;

type Pages = { numPages(): number; layers(page: number): PageLayers | null };

const pastOf = (g: SVGGElement): Element | null => {
  const p = g.previousElementSibling;
  return p?.classList.contains('petu-past') ? p : null;
};

function take(g: SVGGElement): Layer {
  const nodes = [...g.childNodes], past = pastOf(g);
  for (const n of nodes) g.removeChild(n);
  past?.remove();
  // A fade in flight (a new answer retiring the last one's marks) must not leave the layer half transparent.
  g.style.transition = '';
  g.style.opacity = '';
  return { nodes, past };
}

function put(g: SVGGElement, l: Layer) {
  if (l.past) g.parentNode?.insertBefore(l.past, g);
  g.append(...l.nodes);
}

/** Takes every agent mark off the pages (the layers are left empty). An empty map when there were none. */
export function takeMarks(v: Pages): MarksSnapshot {
  const out: MarksSnapshot = new Map();
  for (let p = 1; p <= v.numPages(); p++) {
    const L = v.layers(p);
    if (!L || (!L.highlight.firstChild && !L.agent.firstChild && !pastOf(L.highlight) && !pastOf(L.agent))) continue;
    out.set(p, { highlight: take(L.highlight), agent: take(L.agent) });
  }
  return out;
}

/** Puts a saved question's marks back on their pages (once `takeMarks` has cleared the ones up). */
export function putMarks(v: Pages, snap: MarksSnapshot): void {
  for (const [p, m] of snap) {
    const L = v.layers(p);
    if (!L) continue;
    put(L.highlight, m.highlight);
    put(L.agent, m.agent);
  }
}
