import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chartMarks, chartToPage, formatCharts, parseTick, type Chart } from '../../../src/agent/context/charts';
import { groundPage } from '../../../src/agent/context/build';
import { formatVisible } from '../../../src/agent/context/format';
import type { PaintedPath } from '../../../src/agent/context/marks';
import type { TextLine } from '../../../src/agent/context/textLines';
import type { PageGround } from '../../../src/agent/context/types';

const P = (x: number, y: number) => ({ x, y });
const seg = (ax: number, ay: number, bx: number, by: number): PaintedPath => ({ paint: 'stroke', ops: 'ML', pts: [P(ax, ay), P(bx, by)] });
const frame = (x: number, y: number, w: number, h: number): PaintedPath => ({ paint: 'stroke', ops: 'R', pts: [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)] });
let lid = 0;
const line = (text: string, x: number, y: number, w: number, h = 14): TextLine => {
  const rect = { x, y, w, h };
  return { id: `t${++lid}`, text, rect, runs: [{ text, rect }], math: false };
};
/** A tick label centred under x (x axis at y). */
const below = (text: string, x: number, y: number) => line(text, x - text.length * 4, y + 10, text.length * 8);
/** A tick label right-aligned left of the y axis at x, centred on y. */
const leftOf = (text: string, x: number, y: number) => line(text, x - 8 - text.length * 8, y - 7, text.length * 8);
const near = (a: { x: number; y: number } | null, b: { x: number; y: number }, tol = 0.5) => {
  expect(a).not.toBeNull();
  expect(Math.abs(a!.x - b.x)).toBeLessThan(tol);
  expect(Math.abs(a!.y - b.y)).toBeLessThan(tol);
};

/** An L-shaped chart: x 0..50 at 100..900 (y 800), y 0..6 at 800..200 (x 100), outside ticks. */
function lChart(o: { ticks?: boolean; xs?: string[]; ys?: string[] } = {}) {
  const paths: PaintedPath[] = [seg(100, 800, 900, 800), seg(100, 800, 100, 200)];
  const lines: TextLine[] = [];
  const xs = o.xs ?? ['0', '10', '20', '30', '40', '50'], ys = o.ys ?? ['0', '2', '4', '6'];
  xs.forEach((s, i) => { const x = 100 + i * 160; if (o.ticks !== false) paths.push(seg(x, 800, x, 806)); lines.push(below(s, x, 800)); });
  ys.forEach((s, i) => { const y = 800 - i * 200; if (o.ticks !== false) paths.push(seg(94, y, 100, y)); lines.push(leftOf(s, 100, y)); });
  lines.push(line('Q', 910, 793, 10), line('P', 95, 175, 10));
  return { paths, lines };
}

describe('parseTick', () => {
  it('reads plain, signed, decimal, grouped, percent and power labels', () => {
    expect(parseTick('12')?.v).toBe(12);
    expect(parseTick('−3')?.v).toBe(-3);
    expect(parseTick('–0.25')?.v).toBe(-0.25);
    expect(parseTick('1,500')?.v).toBe(1500);
    expect(parseTick('40%')?.v).toBe(40);
    expect(parseTick('10^3')).toMatchObject({ v: 1000, pow: true });
    expect(parseTick('10⁻²')).toMatchObject({ v: 0.01, pow: true });
    expect(parseTick('1e3')).toMatchObject({ v: 1000, pow: true });
    expect(parseTick('Q')).toBeNull();
    expect(parseTick('TR = 100')).toBeNull();
    expect(parseTick('1.2.3')).toBeNull();
  });
});

describe('chartMarks (synthetic)', () => {
  it('calibrates a linear L chart with ticks, names its axes and maps data exactly', () => {
    const { paths, lines } = lChart();
    const cs = chartMarks(paths, lines, 1);
    expect(cs).toHaveLength(1);
    const c = cs[0];
    expect(c.id).toBe('#c1');
    expect(c.x).toMatchObject({ name: 'Q', lo: 0, hi: 50 });
    expect(c.y).toMatchObject({ name: 'P', lo: 0, hi: 6 });
    near(chartToPage(c, P(25, 3)), P(500, 500));
    near(chartToPage(c, P(0, 0)), P(100, 800));
    expect(c.rect).toEqual({ x: 100, y: 200, w: 800, h: 600 });
    expect(formatCharts(cs)).toBe('#c1 chart 100,200 800×600 x "Q" 0–50, y "P" 0–6');
  });

  it('calibrates from evenly spaced labels without ticks (≥ 3 labels), and scales y by the aspect', () => {
    const { paths, lines } = lChart({ ticks: false });
    const c = chartMarks(paths, lines, 1)[0];
    near(chartToPage(c, P(30, 4)), P(580, 400), 1);
    // A 16:9 page: the same drawing in model coords, labels as tall in x units.
    const a = 0.5625;
    const sq = lChart();
    const ps = sq.paths.map((p) => ({ ...p, pts: p.pts.map((q) => P(q.x, q.y / a)) }));
    const ls = sq.lines.map((l) => { const rect = { ...l.rect, y: l.rect.y / a, h: l.rect.h / a }; return { ...l, rect, runs: [{ text: l.text, rect }] }; });
    const c2 = chartMarks(ps, ls, a)[0];
    expect(c2).toBeDefined();
    near(chartToPage(c2, P(25, 3)), P(500, 500 / a));
  });

  it('a lone label row is not enough: ≥ 2 labels on ticks, or ≥ 3 without', () => {
    const { paths, lines } = lChart({ ticks: false, xs: ['0', '10'] });
    expect(chartMarks(paths, lines, 1)).toEqual([]);
  });

  it('detects a log axis from a geometric progression and from powers of ten', () => {
    const geo = lChart({ ys: ['1', '10', '100', '1000'] });
    const c = chartMarks(geo.paths, geo.lines, 1)[0];
    expect(c.y.log).toBe(true);
    near(chartToPage(c, P(0, Math.sqrt(10))), P(100, 700));
    expect(formatCharts([c])).toContain('y "P" 1–1000 log');
    const pw = lChart({ xs: ['10^-2', '10^-1', '10^0', '10^1', '10^2', '10^3'] });
    const c2 = chartMarks(pw.paths, pw.lines, 1)[0];
    expect(c2.x.log).toBe(true);
    near(chartToPage(c2, P(1, 0)), P(420, 800));
    // Two labels a decade apart could be either: skipped.
    const two = lChart({ ys: ['1', '10'] });
    expect(chartMarks(two.paths, two.lines, 1)).toEqual([]);
  });

  it('calibrates a frame plot with inside ticks and gridlines (matplotlib style)', () => {
    const paths: PaintedPath[] = [frame(120, 100, 760, 600)];
    const lines: TextLine[] = [];
    ['0.0', '0.5', '1.0', '1.5', '2.0'].forEach((s, i) => { const x = 120 + i * 190; paths.push(seg(x, 700, x, 693), seg(x, 100, x, 700)); lines.push(below(s, x, 700)); });
    ['-1', '0', '1'].forEach((s, i) => { const y = 650 - i * 250; paths.push(seg(120, y, 127, y)); lines.push(leftOf(s.replace('-', '−'), 120, y)); });
    lines.push(line('time (s)', 460, 735, 80), line('top title', 450, 70, 100));
    const c = chartMarks(paths, lines, 1)[0];
    expect(c).toBeDefined();
    expect(c.x).toMatchObject({ name: 'time (s)', lo: 0, hi: 2 });
    expect(c.y).toMatchObject({ lo: -1.2, hi: 1 }); // the frame starts at −1.2 (rounded to a tenth of the label step)
    expect(c.y.p0).toBeCloseTo(700);
    near(chartToPage(c, P(1, 0)), P(500, 400));
    near(chartToPage(c, P(2, -1)), P(880, 650));
  });

  it('calibrates axes crossing at the origin with negative labels', () => {
    const paths: PaintedPath[] = [seg(100, 500, 900, 500), seg(500, 100, 500, 900)];
    const lines: TextLine[] = [];
    [-2, -1, 1, 2].forEach((v) => {
      const x = 500 + v * 100, y = 500 - v * 100;
      paths.push(seg(x, 495, x, 505), seg(495, y, 505, y));
      lines.push(below(String(v).replace('-', '−'), x, 500), leftOf(String(v).replace('-', '−'), 495, y));
    });
    const c = chartMarks(paths, lines, 1)[0];
    expect(c).toBeDefined();
    near(chartToPage(c, P(-1.5, 2)), P(350, 300));
    expect(c.x.lo).toBeLessThan(-2);
  });

  it('a table (rules with numbers in its cells) is not a chart', () => {
    const paths: PaintedPath[] = [seg(100, 100, 900, 100), seg(100, 140, 900, 140), seg(100, 400, 900, 400), seg(300, 100, 300, 400), seg(600, 100, 600, 400)];
    const lines: TextLine[] = [line('Year', 120, 110, 40), line('Output', 400, 110, 60), line('Price', 680, 110, 50)];
    for (let i = 0; i < 5; i++) {
      const y = 150 + i * 50;
      lines.push(line(String(1 + i), 180, y, 8), line(String(10 * (i + 1)), 420, y, 16), line(String(50 - i * 5), 700, y, 16));
    }
    // A monotone numeric row right under a rule: still a table row.
    lines.push(line('1', 150, 410, 8), line('2', 400, 410, 8), line('3', 650, 410, 8));
    expect(chartMarks(paths, lines, 1)).toEqual([]);
  });

  it('a bar chart with category labels, or a numbered list beside a rule, is not a calibrated chart', () => {
    const { paths, lines } = lChart({ xs: ['A', 'B', 'C', 'D', 'E', 'F'] });
    expect(chartMarks(paths, lines, 1)).toEqual([]);
    const list = [line('1', 80, 200, 8), line('2', 80, 260, 8), line('3', 80, 320, 8), line('4', 80, 380, 8), line('first item', 120, 200, 80)];
    expect(chartMarks([seg(100, 180, 100, 420)], list, 1)).toEqual([]);
  });

  it('labels whose spacing does not fit (a broken axis) are rejected', () => {
    const { paths, lines } = lChart({ ticks: false, xs: ['0', '10', '20', '30', '70', '80'] });
    expect(chartMarks(paths, lines, 1)).toEqual([]);
  });
});

// Ground truth from scripts/make-decks.ts: Deck.axes boxes (PDF points, top-left origin) on 800×560 pages.
type Box = { x: number; y: number; w: number; h: number; xmax: number; ymax: number };
const truth = (b: Box) => (dx: number, dy: number) => P(((b.x + (dx / b.xmax) * b.w) / 800) * 1000, ((b.y + b.h - (dy / b.ymax) * b.h) / 560) * 1000);
const CASES: { deck: string; page: number; boxes: Box[] }[] = [
  { deck: 'econ', page: 2, boxes: [{ x: 90, y: 150, w: 330, h: 300, xmax: 60, ymax: 14 }] },
  { deck: 'econ', page: 10, boxes: [{ x: 80, y: 140, w: 280, h: 260, xmax: 60, ymax: 14 }, { x: 470, y: 140, w: 260, h: 260, xmax: 60, ymax: 200 }] },
  { deck: 'mechanics', page: 2, boxes: [{ x: 90, y: 140, w: 320, h: 300, xmax: 4, ymax: 16 }] },
  { deck: 'mechanics', page: 5, boxes: [{ x: 70, y: 150, w: 440, h: 230, xmax: 45, ymax: 14 }] },
  { deck: 'mechanics', page: 6, boxes: [{ x: 90, y: 150, w: 330, h: 280, xmax: 90, ymax: 45 }] },
  { deck: 'bio', page: 3, boxes: [{ x: 90, y: 140, w: 330, h: 290, xmax: 20, ymax: 12 }] },
  { deck: 'bio', page: 4, boxes: [{ x: 400, y: 120, w: 320, h: 290, xmax: 20, ymax: 12 }] },
];
const NONE = [['econ', 3], ['econ', 8], ['mechanics', 4], ['mechanics', 7]] as const;

describe('chartMarks on the fixture decks (through groundPage)', () => {
  const grounds = new Map<string, PageGround>();
  beforeAll(async () => {
    const O = pdfjs.OPS as unknown as Record<string, number>;
    for (const deck of ['econ', 'mechanics', 'bio']) {
      const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`public/fixtures/${deck}.pdf`)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
      const pages = [...CASES.filter((c) => c.deck === deck).map((c) => c.page), ...NONE.filter(([d]) => d === deck).map(([, p]) => p)];
      for (const p of pages) grounds.set(`${deck}${p}`, await groundPage(await doc.getPage(p) as never, O));
    }
  });

  for (const k of CASES) {
    it(`${k.deck} p${k.page}: ${k.boxes.length} chart(s), data → page within 1.5 units`, () => {
      const cs = grounds.get(`${k.deck}${k.page}`)!.charts as Chart[];
      expect(cs).toHaveLength(k.boxes.length);
      k.boxes.forEach((b, i) => {
        const c = cs[i], t = truth(b);
        expect(c.id).toBe(`#c${i + 1}`);
        for (const [dx, dy] of [[0, 0], [b.xmax / 2, b.ymax / 3], [b.xmax, b.ymax], [b.xmax * 0.37, b.ymax * 0.81]]) near(chartToPage(c, P(dx, dy)), t(dx, dy), 1.5);
        expect(c.x.log).toBeUndefined();
        expect(c.y.p0).toBeGreaterThan(c.y.p1); // values grow upward
      });
    });
  }

  it('econ p10 lists both charts after the marks', () => {
    const text = formatVisible(grounds.get('econ10')!);
    expect(text).toMatch(/\n#c1 chart 100,236 360×478 x "Q" 0–60, y "P" 0–12\n#c2 chart 588,236 335×478 x "Q" 0–60, y "TR" 0–180$/);
  });

  it('pages without a labelled chart get no charts (and no `charts` key)', () => {
    for (const [d, p] of NONE) expect('charts' in grounds.get(`${d}${p}`)!, `${d} p${p}`).toBe(false);
  });
});
