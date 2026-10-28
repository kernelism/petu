import { useSyncExternalStore } from 'react';

export type Tool = 'pen' | 'highlighter' | 'eraser';
export type StudentStroke = { id: number; page: number; tool: 'pen' | 'highlighter'; color: string; points: [number, number, number][] };
type State = { canvasOn: boolean; tool: Tool; color: string; strokes: StudentStroke[]; undo: StudentStroke[][] };

export const PEN_COLORS = ['#1D1D1F', '#E5484D', '#0A84FF', '#30A46C', '#F2600C'];
let s: State = { canvasOn: false, tool: 'pen', color: PEN_COLORS[0], strokes: [], undo: [] };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { s = { ...s, ...p }; subs.forEach((f) => f()); };
let nextId = 1;

export const ink = {
  get: () => s,
  setCanvas: (on: boolean) => set({ canvasOn: on }),
  setTool: (tool: Tool) => set({ tool, canvasOn: true }),
  setColor: (color: string) => set({ color }),
  add(stroke: Omit<StudentStroke, 'id'>) { set({ undo: [...s.undo, s.strokes], strokes: [...s.strokes, { ...stroke, id: nextId++ }] }); },
  erase(ids: number[]) { if (!ids.length) return; set({ undo: [...s.undo, s.strokes], strokes: s.strokes.filter((x) => !ids.includes(x.id)) }); },
  clear() { if (!s.strokes.length) return; set({ undo: [...s.undo, s.strokes], strokes: [] }); },
  undoLast() { const prev = s.undo[s.undo.length - 1]; if (prev) set({ strokes: prev, undo: s.undo.slice(0, -1) }); },
  reset() { set({ strokes: [], undo: [], canvasOn: false }); },
};
export const useInk = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), ink.get);
