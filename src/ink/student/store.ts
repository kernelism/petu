import { useSyncExternalStore } from 'react';

export type Tool = 'pen' | 'highlighter' | 'eraser';
/**
 * One stroke, permanent until undone, erased or cleared, pinned to what it was drawn on: a page
 * (`page`, points in the page's space: x 0–1000, y 0–spaceH) or a board section (`on`, `page` 0,
 * points in the section's units; `w` its pen width there), so it moves and zooms with it.
 * `round`: the question round it was drawn in (marks since the last question go with the next one).
 */
export type StudentStroke = { id: number; page: number; tool: 'pen' | 'highlighter'; color: string; points: [number, number, number][]; t?: number; round?: number; on?: string; w?: number };
type State = { canvasOn: boolean; tool: Tool; color: string; strokes: StudentStroke[]; undo: StudentStroke[][]; round: number };

/** The student's pen is blue by default, so it never reads as the tutor's ink (v1 learner UX). */
export const PEN_COLORS = ['#0A84FF', '#1D1D1F', '#E5484D', '#30A46C', '#F2600C'];
let s: State = { canvasOn: false, tool: 'pen', color: PEN_COLORS[0], strokes: [], undo: [], round: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
let nextId = 1;

export const ink = {
  get: () => s,
  setCanvas: (on: boolean) => set({ canvasOn: on }),
  setTool: (tool: Tool) => set({ tool, canvasOn: true }),
  setColor: (color: string) => set({ color }),
  /** Adds a stroke (stamped with the time and this round); returns its id. */
  add(stroke: Omit<StudentStroke, 'id'>): number {
    const id = nextId++;
    set({ undo: [...s.undo, s.strokes], strokes: [...s.strokes, { t: Date.now(), round: s.round, ...stroke, id }] });
    return id;
  },
  /** A question was asked: marks drawn from now on go with the next one. */
  nextRound() { set({ round: s.round + 1 }); },
  erase(ids: number[]) { if (!ids.length) return; set({ undo: [...s.undo, s.strokes], strokes: s.strokes.filter((x) => !ids.includes(x.id)) }); },
  clear() { if (!s.strokes.length) return; set({ undo: [...s.undo, s.strokes], strokes: [] }); },
  undoLast() { const prev = s.undo[s.undo.length - 1]; if (prev) set({ strokes: prev, undo: s.undo.slice(0, -1) }); },
  reset() { set({ strokes: [], undo: [], canvasOn: false, round: 0 }); },
};
export const useInk = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), ink.get);
