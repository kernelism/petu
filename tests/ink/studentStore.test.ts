import { beforeEach, describe, expect, it } from 'vitest';
import { ink, PEN_COLORS } from '../../src/ink/student/store';

const stroke = (page = 1) => ({ page, tool: 'pen' as const, color: PEN_COLORS[0], points: [[0, 0, 0.5], [10, 10, 0.5]] as [number, number, number][] });

describe('student ink store', () => {
  beforeEach(() => ink.reset());

  it('adds strokes with unique ids', () => {
    ink.add(stroke());
    ink.add(stroke(2));
    const { strokes } = ink.get();
    expect(strokes).toHaveLength(2);
    expect(strokes[0].id).not.toBe(strokes[1].id);
    expect(strokes[1].page).toBe(2);
  });

  it('erases by id, and erasing nothing is a no-op for undo', () => {
    ink.add(stroke());
    ink.add(stroke());
    const [a, b] = ink.get().strokes;
    ink.erase([]);
    expect(ink.get().undo).toHaveLength(2);
    ink.erase([a.id]);
    expect(ink.get().strokes.map((x) => x.id)).toEqual([b.id]);
  });

  it('undo walks back add, erase and clear', () => {
    ink.add(stroke());
    ink.add(stroke());
    const ids = ink.get().strokes.map((x) => x.id);
    ink.erase([ids[0]]);
    ink.clear();
    expect(ink.get().strokes).toHaveLength(0);
    ink.undoLast();
    expect(ink.get().strokes.map((x) => x.id)).toEqual([ids[1]]);
    ink.undoLast();
    expect(ink.get().strokes.map((x) => x.id)).toEqual(ids);
    ink.undoLast();
    ink.undoLast();
    expect(ink.get().strokes).toHaveLength(0);
    ink.undoLast(); // empty history: no throw
    expect(ink.get().strokes).toHaveLength(0);
  });

  it('clear on empty does not push history', () => {
    ink.clear();
    expect(ink.get().undo).toHaveLength(0);
  });

  it('setTool turns the canvas on', () => {
    expect(ink.get().canvasOn).toBe(false);
    ink.setTool('eraser');
    expect(ink.get()).toMatchObject({ tool: 'eraser', canvasOn: true });
  });
});
