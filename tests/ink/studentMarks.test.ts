import { beforeEach, describe, expect, it } from 'vitest';
import { ink, PEN_COLORS } from '../../src/ink/student/store';
import { freshMarks, liveMarks, markLabel, marks, marksContext } from '../../src/ink/student/marks';
import { Marking } from '../../src/ink/student/marking';
import { pageTarget, phrase, type Line } from '../../src/ink/student/target';

// A page with two lines of text (model coords) and a figure.
const lines: Line[] = [
  { id: 't7', text: 'Price elasticity of demand measures responsiveness', rect: { x: 100, y: 200, w: 500, h: 20 } },
  { id: 't8', text: 'to a change in price along the demand curve', rect: { x: 100, y: 230, w: 440, h: 20 } },
];
const figures = [{ id: '#g2', label: 'Figure 5.2', rect: { x: 600, y: 400, w: 300, h: 300 } }];
const ring = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 40 }, (_, i) => { const t = (i / 39) * Math.PI * 2.05; return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }; });
const P = (pts: { x: number; y: number }[], H = 1000) => pts.map((p) => [p.x, (p.y * H) / 1000, 0.5] as [number, number, number]);

describe('mark targets', () => {
  it('a phrase is whole words between two x', () => {
    expect(phrase(lines[0], 100, 230)).toBe('Price elasticity');
  });

  it('circling part of a line is that phrase; circling two lines is both lines', () => {
    const one = pageTarget('circle', 88, ring(160, 210, 70, 18), lines, figures).target;
    expect(one).toMatchObject({ page: 88, what: 'phrase', ref: 't7' });
    expect(one.text).toContain('elasticity');
    expect(one.text).not.toContain('responsiveness');
    const two = pageTarget('circle', 88, ring(350, 225, 300, 40), lines, figures).target;
    expect(two).toMatchObject({ what: 'lines', ref: 't7,t8' });
  });

  it('an underline names the phrase on the line just above it', () => {
    const t = pageTarget('underline', 88, [{ x: 300, y: 254 }, { x: 540, y: 255 }], lines, figures).target;
    expect(t).toMatchObject({ what: 'phrase', ref: 't8' });
    expect(t.text).toContain('demand curve');
  });

  it('circling a figure names it; a "?" beside a line names the words it sits by', () => {
    expect(pageTarget('circle', 88, ring(750, 550, 200, 200), lines, figures).target).toMatchObject({ what: 'figure', ref: '#g2', text: 'Figure 5.2' });
    const q = pageTarget('confused', 88, ring(625, 210, 8, 12), lines, figures).target;
    expect(q).toMatchObject({ what: 'phrase', ref: 't7' });
    expect(q.text).toContain('responsiveness');
  });

  it('an arrow records what its tail and its tip are on', () => {
    const r = pageTarget('arrow', 88, [{ x: 150, y: 210 }, { x: 700, y: 500 }], lines, figures, { from: { x: 150, y: 210 }, to: { x: 700, y: 500 } });
    expect(r.target).toMatchObject({ ref: 't7' });
    expect(r.to).toMatchObject({ what: 'figure', ref: '#g2' });
  });

  it('the context is text: kind, target text, page (never strokes)', () => {
    const t = pageTarget('underline', 88, [{ x: 300, y: 254 }, { x: 540, y: 255 }], lines, figures).target;
    const s = marksContext([{ kind: 'underline', tool: 'pen', target: t }]);
    expect(s).toContain('underlined "');
    expect(s).toContain('(t8) on page 88');
    expect(s).not.toMatch(/\d+\.\d+,\s*\d/); // no coordinates
    expect(markLabel({ kind: 'underline', tool: 'pen', target: t })).toBe('your underline · p.88');
    expect(markLabel({ kind: 'confused', tool: 'pen', target: { board: 's1', elements: [], text: '' } })).toBe('your ? · board');
  });
});

describe('marks by recency', () => {
  const deps = { page: async () => ({ lines, figures, spaceH: 1400 }), board: () => ({ target: { board: 's1', elements: [], text: '' } }) };
  let m: Marking;
  beforeEach(() => { ink.reset(); marks.reset(); m = new Marking(deps); });
  const add = async (pts: { x: number; y: number }[], extra: object = {}) => {
    const id = ink.add({ page: 88, tool: 'pen', color: PEN_COLORS[0], points: P(pts, 1400), ...extra });
    await m.stroke(ink.get().strokes.find((s) => s.id === id)!);
    return id;
  };
  const ids = () => new Set(ink.get().strokes.map((s) => s.id));
  const chips = () => freshMarks(marks.all(), ids(), ink.get().round);

  it('marks since the last question are chips; after asking they are notes, not sent again', async () => {
    await add(ring(160, 210, 70, 18));
    expect(chips().map((x) => x.kind)).toEqual(['circle']);
    ink.nextRound(); // asked
    expect(chips()).toEqual([]);
    expect(liveMarks(marks.all(), ids())).toHaveLength(1); // still there as a note
    await add([{ x: 300, y: 254 }, { x: 420, y: 254.5 }, { x: 540, y: 255 }]);
    expect(chips().map((x) => x.kind)).toEqual(['underline']);
  });

  it('a removed chip is not sent; undo, eraser and clear take the mark with the ink', async () => {
    const a = await add(ring(160, 210, 70, 18));
    await add([{ x: 300, y: 254 }, { x: 420, y: 254.5 }, { x: 540, y: 255 }]);
    marks.drop(marks.all()[0].id);
    expect(chips().map((x) => x.kind)).toEqual(['underline']);
    ink.undoLast();
    expect(chips()).toEqual([]);
    ink.erase([a]);
    expect(liveMarks(marks.all(), ids())).toEqual([]);
    ink.undoLast(); // the erase undone: the circle is back (still removed from the chips)
    expect(liveMarks(marks.all(), ids()).map((x) => x.kind)).toEqual(['circle']);
    ink.clear();
    expect(liveMarks(marks.all(), ids())).toEqual([]);
  });

  it('a "?" with its dot is one mark; undoing the dot leaves the curl, still a "?"', async () => {
    const hook = [
      ...Array.from({ length: 30 }, (_, i) => { const t = 0.9 * Math.PI + (i / 29) * 1.6 * Math.PI; return { x: 640 + 14 * Math.cos(t), y: 200 + 14 * Math.sin(t) }; }),
      ...Array.from({ length: 8 }, (_, i) => ({ x: 640, y: 214 + (i + 1) * 2.1 })),
    ];
    await add(hook);
    await add([{ x: 640, y: 240 }, { x: 641, y: 241 }, { x: 640.5, y: 242 }]);
    const c = chips();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: 'confused' });
    expect(c[0].strokes).toHaveLength(2);
    expect(c[0].target).toMatchObject({ ref: 't7' });
    ink.undoLast();
    expect(chips().map((x) => [x.kind, x.strokes.length])).toEqual([['confused', 1]]);
  });

  it('board strokes are pinned to their section and marked on it', async () => {
    const id = ink.add({ page: 0, on: 's1', w: 4, tool: 'pen', color: PEN_COLORS[0], points: P(ring(300, 300, 80, 60)) });
    await m.stroke(ink.get().strokes.find((s) => s.id === id)!);
    expect(chips()[0]).toMatchObject({ kind: 'circle', target: { board: 's1' } });
    expect(markLabel(chips()[0])).toBe('your circle · board');
  });
});
