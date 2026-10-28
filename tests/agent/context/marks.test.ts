import { describe, it, expect } from 'vitest';
import { figureMarks, glyphCount, formatMarks, MAX_MARKS, type PaintedPath, type FigureMark } from '../../../src/agent/context/marks';
import type { TextLine } from '../../../src/agent/context/textLines';

const P = (x: number, y: number) => ({ x, y });
const circle = (x: number, y: number, r = 5): PaintedPath => ({ paint: 'fill', ops: 'MCCCC', pts: [P(x - r, y), P(x, y + r), P(x + r, y), P(x, y - r), P(x - r, y)] });
const seg = (a: [number, number], b: [number, number], paint: PaintedPath['paint'] = 'stroke'): PaintedPath => ({ paint, ops: 'ML', pts: [P(...a), P(...b)] });
const tri = (x: number, y: number): PaintedPath => ({ paint: 'fill', ops: 'MLLZ', pts: [P(x - 6, y - 4), P(x, y), P(x - 6, y + 4)] });
const rectPath = (x: number, y: number, w: number, h: number, paint: PaintedPath['paint'] = 'fill'): PaintedPath => ({ paint, ops: 'R', pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] });
const curve = (x: number, y: number, w: number, h: number): PaintedPath => ({ paint: 'stroke', ops: 'MCC', pts: [P(x, y), P(x + w / 2, y + h), P(x + w, y)] });
let lid = 0;
const line = (text: string, x: number, y: number, w: number, h = 20, math = false): TextLine => ({ id: `t${++lid}`, text, rect: { x, y, w, h }, runs: [], math });
const kinds = (ms: FigureMark[]) => ms.map((m) => m.kind);

describe('figureMarks', () => {
  it('finds a dot, and turns a segment with a triangle at one end into an arrow toward it', () => {
    const ms = figureMarks([circle(100, 100), seg([300, 300], [500, 300]), tri(500, 300)], [], [], 1);
    expect(kinds(ms)).toEqual(['dot', 'arrow']);
    const a = ms[1] as Extract<FigureMark, { from: unknown }>;
    expect(a.to).toEqual({ x: 500, y: 300 });
    const back = figureMarks([seg([300, 300], [500, 300]), tri(300, 300)], [], [], 1)[0] as Extract<FigureMark, { from: unknown }>;
    expect(back.kind).toBe('arrow');
    expect(back.to).toEqual({ x: 300, y: 300 });
  });

  it('treats a short rule between a math numerator and a denominator as a fraction bar, not a line', () => {
    const ms = figureMarks([seg([200, 330], [260, 330])], [], [line('x f', 205, 305, 50, 20, true), line('z', 225, 335, 10, 20)], 1);
    expect(ms.filter((m) => m.kind === 'line')).toHaveLength(0);
    // A rule under a lone formula label (a dimension line in a figure) stays a line.
    const dim = figureMarks([seg([200, 330], [260, 330])], [], [line('zi=10', 205, 305, 50, 20, true)], 1);
    expect(dim.filter((m) => m.kind === 'line')).toHaveLength(1);
  });

  it('text inside a box names the box, not a nearby grid line', () => {
    const ms = figureMarks([rectPath(600, 500, 45, 32, 'stroke'), seg([600, 532], [790, 532])], [], [line('G', 615, 508, 12, 18)], 1);
    expect(ms.find((m) => m.kind === 'box')!.label).toBe('G');
    expect(ms.find((m) => m.kind === 'line')!.label).toBeUndefined();
    // A large frame full of text (a plot) does not swallow its labels.
    const lines = [line('A long caption sitting inside the frame', 120, 120, 300), line('O', 512, 410, 10)];
    const plot = figureMarks([rectPath(100, 100, 700, 600, 'stroke'), circle(500, 400)], [], lines, 1);
    expect(plot.find((m) => m.kind === 'dot')!.label).toBe('O');
  });

  it('names a segment by the dots at its ends', () => {
    const ms = figureMarks([circle(200, 800), circle(700, 800), seg([200, 800], [700, 800])], [], [], 1);
    expect(formatMarks(ms)).toBe('#d1 dot 200,800\n#d2 dot 700,800\n#s1 line #d1→#d2');
  });

  it('a fill+stroke path written as "ML" is still a line', () => {
    const ms = figureMarks([circle(238, 813), circle(713, 813), seg([238, 813], [713, 813], 'both')], [], [], 0.7);
    expect(formatMarks(ms)).toContain('#s1 line #d1→#d2');
  });

  it('gives a short label to a dot over a slightly nearer but longer segment', () => {
    const ms = figureMarks([circle(400, 400), seg([380, 435], [600, 435])], [], [line('x', 395, 410, 10)], 1);
    const dot = ms.find((m) => m.kind === 'dot')!;
    expect(dot.label).toBe('x');
    expect(ms.find((m) => m.kind === 'line')!.label).toBeUndefined();
  });

  it('drops a header bar spanning the page top and page-wide rules', () => {
    const ms = figureMarks([rectPath(0, 0, 1000, 80), seg([20, 90], [980, 90]), rectPath(100, 300, 200, 200, 'stroke')], [], [], 0.5625);
    expect(kinds(ms)).toEqual(['box']);
  });

  it('clusters overlapping unlabelled curves into one figure', () => {
    const ms = figureMarks([curve(100, 500, 200, 100), curve(150, 520, 200, 80), curve(250, 480, 150, 120)], [], [], 1);
    expect(ms).toHaveLength(1);
    expect(ms[0].kind).toBe('figure');
    expect(formatMarks(ms)).toMatch(/^#g1 figure 100,480 300×\d+ \(3 paths\)$/);
  });

  it('caps at MAX_MARKS in priority order (labelled first, then dots, arrows, lines, images)', () => {
    const paths: PaintedPath[] = [];
    for (let i = 0; i < 20; i++) paths.push(circle(30 + i * 22, 30));
    for (let i = 0; i < 20; i++) paths.push(seg([300, 100 + i * 15], [400, 100 + i * 15]), tri(400, 100 + i * 15));
    for (let i = 0; i < 20; i++) paths.push(seg([50, 100 + i * 15], [150, 100 + i * 15]));
    for (let i = 0; i < 3; i++) paths.push(rectPath(500 + i * 150, 100, 100, 60, 'stroke'));
    const images = Array.from({ length: 10 }, (_, i) => ({ rect: { x: 500 + (i % 5) * 90, y: 400 + Math.floor(i / 5) * 150, w: 80, h: 80 } }));
    const lines = [0, 1, 2].map((i) => line(`Box ${i}`, 510 + i * 150, 120, 60));
    const ms = figureMarks(paths, images, lines, 1);
    expect(ms).toHaveLength(MAX_MARKS);
    expect(kinds(ms.slice(0, 3))).toEqual(['box', 'box', 'box']);
    expect(ms.slice(0, 3).map((m) => m.label)).toEqual(['Box 0', 'Box 1', 'Box 2']);
    expect(new Set(kinds(ms.slice(3, 23)))).toEqual(new Set(['dot']));
    expect(new Set(kinds(ms.slice(23, 43)))).toEqual(new Set(['arrow']));
    expect(ms.filter((m) => m.kind === 'line')).toHaveLength(17);
    expect(ms.filter((m) => m.kind === 'image')).toHaveLength(0);
    expect(ms.slice(3, 6).map((m) => m.id)).toEqual(['#d1', '#d2', '#d3']);
  });

  it('merges stacked math lines and the fraction bar between them into one equation', () => {
    const lines = [line('x − xʹ', 200, 300, 60, 20, true), line('B f', 205, 335, 40, 20, true), line('z', 222, 372, 10, 20, true), line('Prose that is not math at all', 50, 600, 400)];
    const ms = figureMarks([seg([200, 366], [270, 366])], [], lines, 1);
    const eqs = ms.filter((m) => m.kind === 'equation');
    expect(eqs).toHaveLength(1);
    expect(formatMarks(eqs)).toBe('#e1 equation 200,300 70×92 "x − xʹ B f z"');
    expect(ms.filter((m) => m.kind === 'line')).toHaveLength(0);
  });

  it('turns a flood of anonymous lines (perspective rays, hatching) into a figure', () => {
    const paths: PaintedPath[] = [circle(500, 300), circle(800, 300), seg([500, 300], [800, 300])];
    for (let i = 0; i < 40; i++) paths.push(seg([510, 400 + i * 5], [850, 300 + i * 3]));
    const ms = figureMarks(paths, [], [line('C', 495, 270, 10)], 1);
    expect(formatMarks(ms).split('\n')).toEqual(['#d1 dot 500,300 "C"', '#d2 dot 800,300', '#s1 line #d1→#d2', '#g1 figure 510,300 340×295 (40 paths)']);
  });

  it('renumbers ids in listing order and keeps segment ends on their dots', () => {
    const ms = figureMarks([circle(100, 100), circle(300, 100), circle(500, 500), seg([300, 100], [500, 500])], [], [line('B', 530, 495, 10)], 1);
    expect(formatMarks(ms).split('\n')).toEqual(['#d1 dot 500,500 "B"', '#d2 dot 100,100', '#d3 dot 300,100', '#s1 line #d3→#d1']);
  });

  it('a short non-math line joins an equation only through a fraction bar', () => {
    const num = line('B ⋅ f', 600, 737, 50, 25, true);
    const bar = seg([598, 768], [656, 768]);
    expect(formatMarks(figureMarks([bar], [], [num, line('z', 622, 775, 12, 25)], 1))).toBe('#e1 equation 598,737 58×63 "B ⋅ f z"');
    // Without the bar, a nearby label stays out (and alone is no equation).
    expect(figureMarks([], [], [num, line('z', 622, 765, 12, 25)], 1)).toEqual([]);
  });

  it('does not make an equation of a lone one-line formula', () => {
    expect(figureMarks([], [], [line('x − xʹ = B', 200, 300, 90, 20, true)], 1)).toEqual([]);
  });

  it('equations drawn as glyph outlines on a page with text become one #e box per formula, not a flood', () => {
    const glyph = (x: number, y: number): PaintedPath => ({ paint: 'fill', ops: 'MLCLZ', pts: [P(x, y), P(x + 6, y), P(x + 7, y + 5), P(x, y + 9)] });
    const paths: PaintedPath[] = [];
    for (let i = 0; i < 30; i++) paths.push(glyph(200 + i * 8, 300));
    for (let i = 0; i < 30; i++) paths.push(glyph(200 + i * 8, 500));
    paths.push(glyph(700, 700)); // an inline symbol: left out
    const ms = figureMarks(paths, [], [line('Use the limit laws to evaluate', 100, 100, 400)], 1);
    expect(glyphCount(paths, 1)).toBe(61);
    expect(ms.map((m) => m.kind)).toEqual(['equation', 'equation']);
    expect(formatMarks(ms).split('\n')[0]).toBe('#e1 equation 200,300 239×9 (30 paths)');
  });

  it('text drawn as outlines does not flood the page with dots or arrowheads', () => {
    const paths: PaintedPath[] = [];
    for (let row = 0; row < 10; row++) for (let i = 0; i < 40; i++) {
      paths.push(circle(100 + i * 8, 100 + row * 17, 3));
      paths.push(tri(102 + i * 8, 106 + row * 17));
    }
    const ms = figureMarks(paths, [], [], 1.29);
    expect(ms.filter((m) => m.kind === 'dot' || m.kind === 'arrow')).toHaveLength(0);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.length).toBeLessThanOrEqual(10);
    expect(ms.every((m) => m.kind === 'figure')).toBe(true);
  });

  it('merges a photo tiled into strips into one image and ignores tiny ones', () => {
    const images = [0, 1, 2, 3].map((i) => ({ rect: { x: 100, y: 200 + i * 50, w: 300, h: 50 } }));
    images.push({ rect: { x: 900, y: 900, w: 10, h: 10 } });
    const ms = figureMarks([], images, [], 1);
    expect(formatMarks(ms)).toBe('#i1 image 100,200 300×200');
  });

  it('handles a huge path count quickly', () => {
    const paths: PaintedPath[] = [];
    for (let i = 0; i < 6000; i++) paths.push(curve((i * 7) % 900, 100 + ((i * 13) % 800), 20, 10));
    const t0 = performance.now();
    const ms = figureMarks(paths, [], [], 1);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(ms.length).toBeLessThanOrEqual(MAX_MARKS);
  });
});

describe('clusters', () => {
  type B = { x0: number; y0: number; x1: number; y1: number };
  /** The reference: merge any two clusters whose boxes are within pad, until none are. */
  const slow = (bs: B[], pad: number) => {
    let cs = bs.map((b) => ({ box: { ...b }, n: 1 }));
    const near = (a: B, b: B) => a.x0 - pad <= b.x1 && b.x0 - pad <= a.x1 && a.y0 - pad <= b.y1 && b.y0 - pad <= a.y1;
    for (let again = true; again;) {
      again = false;
      outer: for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) if (near(cs[i].box, cs[j].box)) {
        const a = cs[i].box, b = cs[j].box;
        cs[i] = { box: { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }, n: cs[i].n + cs[j].n };
        cs.splice(j, 1); again = true; break outer;
      }
    }
    return cs;
  };
  const key = (cs: { box: B; n: number }[]) => cs.map((c) => `${c.box.x0},${c.box.y0},${c.box.x1},${c.box.y1}:${c.n}`).sort();
  it('matches the reference single-linkage result', async () => {
    const { clusters } = await import('../../../src/agent/context/marks');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      const bs = Array.from({ length: 60 }, () => { const x = rnd() * 1000, y = rnd() * 700, w = rnd() * 60, h = rnd() * 40; return { x0: x, y0: y, x1: x + w, y1: y + h }; });
      expect(key(clusters(bs, 10))).toEqual(key(slow(bs, 10)));
    }
  });
  it('is fast on thousands of boxes, chained or scattered', async () => {
    const { clusters } = await import('../../../src/agent/context/marks');
    const chain = Array.from({ length: 6000 }, (_, i) => ({ x0: i * 0.15, y0: (i % 7) * 50, x1: i * 0.15 + 0.1, y1: (i % 7) * 50 + 60 })).reverse();
    const grid = Array.from({ length: 6000 }, (_, i) => ({ x0: (i % 80) * 12, y0: Math.floor(i / 80) * 12, x1: (i % 80) * 12 + 1, y1: Math.floor(i / 80) * 12 + 1 }));
    const t0 = performance.now();
    expect(clusters(chain, 10)).toHaveLength(1);
    expect(clusters(grid, 2)).toHaveLength(6000);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
