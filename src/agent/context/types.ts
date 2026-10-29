// src/agent/context/types.ts
import type { GroundMark, Grounding } from '../../geometry/resolve';
import type { TextLine } from './textLines';
import type { FigureMark } from './marks';
import { noteCharts, type Chart } from './charts';

/** Everything known about one page, built once per page (LRU) on scroll idle. */
export type PageGround = {
  page: number;
  aspect: number; // h / w
  lines: TextLine[];
  marks: FigureMark[];
  /** No usable text layer (scan, broken ToUnicode): quotes are disabled for this page. */
  noText: boolean;
  /** Its equations are drawn as glyph outlines (≥ GLYPH_FLOOD small filled paths): absent from the text, only in the image. */
  mathOutlines?: boolean;
  /** Calibrated charts (`#c1`…): axes fitted from ticks and tick labels. Absent or empty: none trusted. */
  charts?: Chart[];
};

/** The marks of the pages sent with the current question, by page: the director's Grounding. */
export function groundingOf(pages: PageGround[]): Grounding {
  const by = new Map(pages.map((p) => [p.page, p]));
  const g: Grounding = {
    aspect: (page) => by.get(page)?.aspect,
    obstacles(page) {
      const g = by.get(page);
      if (!g) return [];
      // Text lines and everything drawn with an extent (figures, images, equations, boxes, charts).
      const rects = g.lines.map((l) => l.rect);
      for (const m of g.marks) if ('rect' in m) rects.push(m.rect);
      for (const c of g.charts ?? []) rects.push(c.rect);
      return rects;
    },
    mark(page, id): GroundMark | undefined {
      const g = by.get(page);
      if (!g) return undefined;
      if (/^#t\d+$/.test(id)) {
        const l = g.lines.find((x) => `#${x.id}` === id);
        return l ? { kind: 'text', rect: l.rect, text: l.text } : undefined;
      }
      if (/^#c\d+$/.test(id)) {
        const c = g.charts?.find((x) => x.id === id);
        return c ? { kind: 'chart', rect: c.rect, x: c.x, y: c.y } : undefined;
      }
      const m = g.marks.find((x) => x.id === id);
      if (!m) return undefined;
      if (m.kind === 'dot') return { kind: 'dot', at: m.at };
      if ('from' in m) return { kind: m.kind, from: m.from, to: m.to };
      return { kind: m.kind, rect: m.rect };
    },
  };
  // The live parser's value model reads chart axes from the latest grounding (charts.ts latestCharts).
  noteCharts(g);
  return g;
}
