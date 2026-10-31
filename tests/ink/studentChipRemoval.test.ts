// Founder report 2026-10-30: a removed stroke still showed as a chip. Every way a mark goes takes its
// chip with it at once: the chip's ×, ⌘Z, the eraser, "Clear my marks", a new document, and a board
// section that leaves (its target gone).
import { beforeEach, describe, expect, it } from 'vitest';
import { ink, PEN_COLORS } from '../../src/ink/student/store';
import { freshMarks, marks } from '../../src/ink/student/marks';
import { Marking } from '../../src/ink/student/marking';
import { takeMarks, targetAlive } from '../../src/ink/student/ask';
import { createSection } from '../../src/desk/Desk';

const deps = { page: async () => ({ lines: [{ id: 't1', text: 'marginal cost rises', rect: { x: 100, y: 300, w: 300, h: 20 } }], figures: [], spaceH: 1000 }), board: (on: string) => ({ target: { board: on, elements: [], text: '' } }) };
const ring = Array.from({ length: 40 }, (_, i) => { const t = (i / 39) * Math.PI * 2.05; return [250 + 160 * Math.cos(t), 310 + 30 * Math.sin(t), 0.5] as [number, number, number]; });
const chips = () => freshMarks(marks.all(), new Set(ink.get().strokes.map((s) => s.id)), ink.get().round, targetAlive);

describe('chips leave with their marks', () => {
  let m: Marking;
  beforeEach(() => { ink.reset(); marks.reset(); m = new Marking(deps); document.body.innerHTML = ''; });
  const draw = async (o: object = {}) => { const id = ink.add({ page: 1, tool: 'pen', color: PEN_COLORS[0], points: ring, ...o }); await m.stroke(ink.get().strokes.find((s) => s.id === id)!); return id; };

  it("the chip's ×", async () => { await draw(); marks.drop(chips()[0].id); expect(chips()).toEqual([]); expect(takeMarks().context).toBe(''); });
  it('⌘Z', async () => { await draw(); ink.undoLast(); expect(chips()).toEqual([]); expect(takeMarks().context).toBe(''); });
  it('the eraser', async () => { const a = await draw(); await draw(); ink.erase([a]); expect(chips()).toHaveLength(1); });
  it('"Clear my marks" clears every chip', async () => { await draw(); await draw({ page: 2 }); ink.clear(); expect(chips()).toEqual([]); expect(takeMarks().context).toBe(''); });
  it('a new document', async () => { await draw(); ink.reset(); marks.reset(); expect(chips()).toEqual([]); });
  it('a board section that leaves (the answer cleared)', async () => {
    const sec = createSection({ id: 'b1', page: 1, size: 'm' } as Parameters<typeof createSection>[0]);
    document.body.appendChild(sec.el);
    await draw({ page: 0, on: 'b1' });
    expect(chips()).toHaveLength(1);
    sec.el.remove();
    expect(chips()).toEqual([]);
    expect(takeMarks().context).toBe('');
  });
});
