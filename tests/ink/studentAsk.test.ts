// What a question carries of the student's marks (src/ink/student/ask.ts takeMarks): the marks since
// the last question, as text; their page strokes for STUDENT INK; then they are notes, not sent again.
import { beforeEach, describe, expect, it } from 'vitest';
import { ink, PEN_COLORS } from '../../src/ink/student/store';
import { marks } from '../../src/ink/student/marks';
import { Marking } from '../../src/ink/student/marking';
import { takeMarks } from '../../src/ink/student/ask';
import type { Line } from '../../src/ink/student/target';

const lines: Line[] = [{ id: 't3', text: 'Opportunity cost is the value of the next best alternative', rect: { x: 100, y: 300, w: 600, h: 20 } }];
const deps = { page: async () => ({ lines, figures: [], spaceH: 1000 }), board: () => ({ target: { board: 's1', elements: ['plot #d'], text: 'demand' } }) };
const pts = (p: { x: number; y: number }[]) => p.map((q) => [q.x, q.y, 0.5] as [number, number, number]);
const under = pts([{ x: 120, y: 326 }, { x: 300, y: 327 }, { x: 480, y: 326 }]);

describe('marks sent with a question', () => {
  let m: Marking;
  beforeEach(() => { ink.reset(); marks.reset(); m = new Marking(deps); });
  const draw = async (o: object) => { const id = ink.add({ page: 2, tool: 'pen', color: PEN_COLORS[0], points: under, ...o }); await m.stroke(ink.get().strokes.find((s) => s.id === id)!); return id; };

  it('sends kind, target text and page as text; the page strokes for STUDENT INK; never board strokes', async () => {
    const a = await draw({});
    await draw({ page: 0, on: 's1', points: pts([{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 0, y: 120 }]) });
    const t = takeMarks(() => true); // (no Desk here: the board section counts as present)
    expect(t.labels).toEqual(['your underline · p.2', 'your note · board']);
    expect(t.context).toContain('underlined "');
    expect(t.context).toContain('(t3) on page 2');
    expect(t.context).toContain('"demand" on the board (plot #d)');
    expect(t.context).not.toMatch(/points|\[\d/);
    expect(t.strokes.map((s) => s.id)).toEqual([a]);
  });

  it('after asking, the marks are notes: the next question carries only new ones', async () => {
    await draw({});
    takeMarks();
    expect(takeMarks()).toEqual({ context: '', labels: [], strokes: [] });
    const b = await draw({});
    expect(takeMarks().strokes.map((s) => s.id)).toEqual([b]);
  });

  it('a removed chip is not sent; a stroke still being read is', async () => {
    await draw({});
    marks.drop(marks.all()[0].id);
    const pending = ink.add({ page: 2, tool: 'pen', color: PEN_COLORS[0], points: under });
    const t = takeMarks();
    expect(t.context).toBe('');
    expect(t.strokes.map((s) => s.id)).toEqual([pending]);
  });
});
