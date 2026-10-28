// src/agent/context/types.ts
import type { GroundMark, Grounding } from '../../geometry/resolve';
import type { TextLine } from './textLines';
import type { FigureMark } from './marks';

/** Everything known about one page, built once per page (LRU) on scroll idle. */
export type PageGround = {
  page: number;
  aspect: number; // h / w
  lines: TextLine[];
  marks: FigureMark[];
  /** No usable text layer (scan, broken ToUnicode): quotes are disabled for this page. */
  noText: boolean;
};

/** The marks of the pages sent with the current question, by page: the director's Grounding. */
export function groundingOf(pages: PageGround[]): Grounding {
  const by = new Map(pages.map((p) => [p.page, p]));
  return {
    mark(page, id): GroundMark | undefined {
      const g = by.get(page);
      if (!g) return undefined;
      if (/^#t\d+$/.test(id)) {
        const l = g.lines.find((x) => `#${x.id}` === id);
        return l ? { kind: 'text', rect: l.rect, text: l.text } : undefined;
      }
      const m = g.marks.find((x) => x.id === id);
      if (!m) return undefined;
      if (m.kind === 'dot') return { kind: 'dot', at: m.at };
      if ('from' in m) return { kind: m.kind, from: m.from, to: m.to };
      return { kind: m.kind, rect: m.rect };
    },
  };
}
