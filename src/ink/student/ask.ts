// src/ink/student/ask.ts — the student's marks meeting a question: what goes with it (by recency),
// and how board and page targets are read for the marking (App wires these in).
import type { FigureMark } from '../../agent/context/marks';
import { bbox, type MarkKind, type Pt } from './gesture';
import { freshMarks, markLabel, marks, marksContext } from './marks';
import { ink, type StudentStroke } from './store';
import { phrase, type BoardTarget, type Figure, type Target } from './target';
import { sectionEl, toSection } from './BoardInk';

/** How long the marking waits for a page's grounding before it reads the text layer alone. */
export const GROUND_WAIT_MS = 2500;
/** A lone "?" and this long without another stroke: the bar takes focus with its chip. */
export const ASK_PAUSE_MS = 1200;
/** What Enter on an empty bar asks with a "?" chip. */
export const EXPLAIN_THIS = 'Explain this.';

/**
 * A question is asked: the marks drawn since the last one (not removed) go with it, as text (`context`,
 * the `about` note), chip labels (the trail's title) and their page strokes (STUDENT INK: summarised as
 * text with a crop of the page; a stroke still being read goes too). Then a new round starts: these
 * marks stay on the page as notes and are not sent again.
 */
export function takeMarks(alive: (t: Target) => boolean = targetAlive): { context: string; labels: string[]; strokes: StudentStroke[]; page?: number } {
  const st = ink.get();
  const all = marks.all();
  const sent = freshMarks(all, new Set(st.strokes.map((s) => s.id)), st.round, alive);
  const inSent = new Set(sent.flatMap((m) => m.strokes));
  const inMark = new Set(all.flatMap((m) => m.strokes));
  const strokes = st.strokes.filter((s) => s.on == null && s.round === st.round && (inSent.has(s.id) || !inMark.has(s.id)));
  ink.nextRound();
  // The page the marks are on (the asked page, src/agent/moment.ts askedPage): the latest page mark's, else the latest page stroke's.
  const onPage = [...sent].reverse().find((m) => 'page' in m.target)?.target as { page: number } | undefined;
  const page = onPage?.page ?? strokes.filter((s) => s.page > 0).at(-1)?.page;
  return { context: marksContext(sent), labels: sent.map(markLabel), strokes, ...(page ? { page } : {}) };
}

/** A mark's target is still there: a page always is (a new document resets the marks); a board section may have left. */
export const targetAlive = (t: Target): boolean => !('board' in t) || !!sectionEl(t.board);

/** The trail header's "About …": one or two things by name, more as a count ("your 4 marks"). */
export function aboutTitle(labels: string[]): string | null {
  if (!labels.length) return null;
  return labels.length <= 2 ? labels.join(', ') : `your ${labels.length} marks`;
}

/** A page's figure marks as boxes (a dot or a segment: its extent). */
export function figuresOf(ms: FigureMark[]): Figure[] {
  return ms.map((m) => {
    if (m.kind === 'dot') return { id: m.id, ...(m.label ? { label: m.label } : {}), rect: { x: m.at.x - 8, y: m.at.y - 8, w: 16, h: 16 } };
    if ('from' in m) {
      const x = Math.min(m.from.x, m.to.x), y = Math.min(m.from.y, m.to.y);
      return { id: m.id, ...(m.label ? { label: m.label } : {}), rect: { x, y, w: Math.abs(m.to.x - m.from.x), h: Math.abs(m.to.y - m.from.y) } };
    }
    return { id: m.id, ...(m.label ? { label: m.label } : {}), rect: m.rect };
  });
}

type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (r: Rect, d: number, up = d): Rect => ({ x: r.x - d, y: r.y - up, w: r.w + 2 * d, h: r.h + d + up });

/**
 * What a board stroke is on, in its section's units: the drawn elements (`elements(id)`, the
 * registry's) and the board's words it covers (a circle: inside; an underline: just above; an arrow:
 * at each end; a "?" or a note: beside it). The words come from the section's own text.
 */
export function boardTarget(on: string, pts: Pt[], kind: MarkKind, ends: { from: Pt; to: Pt } | undefined, elements: (id: string) => { name: string; rect: Rect }[]): { target: BoardTarget; to?: BoardTarget } {
  const el = sectionEl(on);
  const t = el && toSection(el);
  const texts: { text: string; rect: Rect }[] = [];
  if (el && t) {
    for (const n of el.querySelectorAll<SVGTextElement>('text')) {
      const r = n.getBoundingClientRect();
      if (!r.width || !(n.textContent ?? '').trim()) continue;
      const a = t.map(r.left, r.top), b = t.map(r.right, r.bottom);
      texts.push({ text: n.textContent!.replace(/\s+/g, ' ').trim(), rect: { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y } });
    }
  }
  const els = elements(on);
  const at = (area: Rect, within?: Rect): BoardTarget => ({
    board: on,
    elements: els.filter((e) => hit(e.rect, area)).map((e) => e.name).slice(0, 8),
    text: texts.filter((x) => hit(x.rect, area)).map((x) => (within ? phrase({ text: x.text, rect: x.rect }, within.x, within.x + within.w) : x.text)).join(' ').slice(0, 300),
  });
  const b = bbox(pts);
  if (kind === 'arrow' && ends) {
    const end = (p: Pt) => at({ x: p.x - 30, y: p.y - 30, w: 60, h: 60 });
    return { target: end(ends.from), to: end(ends.to) };
  }
  if (kind === 'circle') return { target: at(b) };
  if (kind === 'underline') return { target: at(grow(b, 4, 40), b) };
  return { target: at(grow(b, 40)) };
}
