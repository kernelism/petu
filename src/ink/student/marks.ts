// src/ink/student/marks.ts — the student's marks (spec "Student ink"): a gesture's meaning and its
// target, kept beside the ink (src/ink/student/store.ts), never altering it. Context by recency:
// marks drawn since the last question (this `round`) are the next question's chips; older ones are
// notes and are not sent. A mark lives as long as its strokes: undo, the eraser and "Clear my marks"
// take it with them.
import { useSyncExternalStore } from 'react';
import type { MarkKind } from './gesture';
import type { BoardTarget, PageTarget, Target } from './target';

export type Mark = {
  id: number;
  kind: MarkKind;
  tool: 'pen' | 'highlighter';
  /** Its strokes (ids in the ink store), in drawing order. */
  strokes: number[];
  target: Target;
  /** An arrow's head end (`target` is its tail). */
  to?: Target;
  /** The question round it was drawn in (store.ts `round`). */
  round: number;
  /** The student removed its chip: it stays on the page as a note and is not sent. */
  dropped?: boolean;
  /** Before a second stroke joined it (a "?"'s dot, an arrow's head): what its first stroke alone meant. */
  alone?: { kind: MarkKind; target: Target; to?: Target };
};

let list: Mark[] = [];
const subs = new Set<() => void>();
const emit = () => { list = list.slice(); subs.forEach((f) => f()); };
let nextId = 1;

export const marks = {
  all: () => list,
  /** Adds a mark (returns its id). */
  add(m: Omit<Mark, 'id'>): number { const id = nextId++; list.push({ ...m, id }); emit(); return id; },
  /** Updates a mark in place (a joined stroke, a target resolved). */
  update(id: number, p: Partial<Omit<Mark, 'id'>>) { const i = list.findIndex((m) => m.id === id); if (i < 0) return; list[i] = { ...list[i], ...p }; emit(); },
  /** Its chip was removed: not sent with the next question (the ink stays). */
  drop(id: number) { marks.update(id, { dropped: true }); },
  reset() { list = []; emit(); },
};
export const useMarks = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), marks.all);

/**
 * The marks whose ink is still there. A joined mark that lost its later stroke (⌘Z on a "?"'s dot)
 * is again what its first stroke meant; one that lost its first stroke is gone.
 */
export function liveMarks(all: Mark[], strokeIds: Set<number>): Mark[] {
  const out: Mark[] = [];
  for (const m of all) {
    const have = m.strokes.filter((s) => strokeIds.has(s));
    if (!have.length || !strokeIds.has(m.strokes[0])) continue;
    if (have.length === m.strokes.length) out.push(m);
    else if (m.alone) out.push({ ...m, ...m.alone, strokes: [m.strokes[0]] });
  }
  return out;
}

/**
 * The chips: live marks drawn since the last question, not removed, whose target is still there
 * (`alive`: a board section that left takes its marks' chips with it).
 */
export const freshMarks = (all: Mark[], strokeIds: Set<number>, round: number, alive: (t: Target) => boolean = () => true) =>
  liveMarks(all, strokeIds).filter((m) => m.round === round && !m.dropped && alive(m.target) && (!m.to || alive(m.to)));

const NAME: Record<MarkKind, string> = { circle: 'circle', underline: 'underline', arrow: 'arrow', confused: '?', note: 'note' };
const isBoard = (t: Target): t is BoardTarget => 'board' in t;

/** The chip: "your underline · p.88" ("your highlight" for the highlighter, "· board" on the drawing). */
export function markLabel(m: Pick<Mark, 'kind' | 'tool' | 'target'>): string {
  const name = m.tool === 'highlighter' ? 'highlight' : NAME[m.kind];
  return `your ${name} · ${isBoard(m.target) ? 'board' : `p.${m.target.page}`}`;
}

const q = (s: string) => `"${s.replace(/\s+/g, ' ').trim()}"`;
function on(t: Target): string {
  if (isBoard(t)) {
    const els = t.elements.length ? ` (${t.elements.slice(0, 6).join(', ')})` : '';
    return t.text ? `${q(t.text)} on the board${els}` : `part of the board${els || ' with nothing drawn'}`;
  }
  const p = t as PageTarget;
  // The ids as the page listing shows them (t7, #g2).
  const ref = p.ref ? ` (${p.ref.split(',').join(', ')})` : '';
  if (p.what === 'figure') return `${p.text ? `the figure ${q(p.text)}` : 'a figure'}${ref} on page ${p.page}`;
  if (p.what === 'area' || !p.text) return `an empty spot on page ${p.page}${p.area ? ` (x ${p.area.x}–${p.area.x + p.area.w}, y ${p.area.y}–${p.area.y + p.area.h} of 1000)` : ''}`;
  return `${q(p.text)}${ref} on page ${p.page}`;
}

/** One line of context for the model: the kind, its target's text, the page (never the strokes). */
export function markContext(m: Pick<Mark, 'kind' | 'tool' | 'target' | 'to'>): string {
  switch (m.kind) {
    case 'circle': return `circled ${on(m.target)}`;
    case 'underline': return `${m.tool === 'highlighter' ? 'highlighted' : 'underlined'} ${on(m.target)}`;
    case 'arrow': return `drew an arrow from ${on(m.target)} to ${m.to ? on(m.to) : 'somewhere nearby'} (relating the two)`;
    case 'confused': return `drew a "?" by ${on(m.target)}: confused here`;
    default: return `wrote a note by ${on(m.target)}`;
  }
}

/** The `about` context for marks sent with a question: one line each, in drawing order. */
export function marksContext(ms: Pick<Mark, 'kind' | 'tool' | 'target' | 'to'>[]): string {
  if (!ms.length) return '';
  return [
    `The student marked ${ms.length === 1 ? 'this' : 'these'} just before asking (the marks stay on the page in their own ink; you may refer to them, e.g. "the line you underlined"):`,
    ...ms.map((m) => `- ${markContext(m)}`),
  ].join('\n');
}
