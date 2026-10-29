// Generates the two synthetic eval decks (Eval v3): public/fixtures/econ.pdf (intro microeconomics:
// supply, demand, elasticity) and public/fixtures/mechanics.pdf (intro mechanics: motion and forces).
// They exist so the eval is not tuned to one course: other domains, real vector figures (axes,
// curves, labelled points, diagrams) and equations. 800x560 pt pages like the epipolar fixture.
// Coordinates are measured from the TOP-left; pdf-lib uses a bottom-left origin, so pdfY = H - y.
// Deterministic: fixed metadata dates, so a re-run produces the same bytes.
//   npm run decks
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const W = 800;
const H = 560;
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const INK = hex('#1d1d1f');
const BODY = hex('#3a3a3c');
const GRAY = hex('#8e8e93');
const BLUE = hex('#2f5d9b');
const RED = hex('#b23a2e');
const GREEN = hex('#2e7d4f');
const TINT_B = hex('#dfe8f5');
const TINT_R = hex('#f6e0dc');
const TINT_G = hex('#dcefe3');
const PANEL = hex('#f5f5f7');

type Fonts = { sans: PDFFont; bold: PDFFont; serif: PDFFont; italic: PDFFont; sym: PDFFont };
type Pt = [number, number];

/** Greek and operators drawn from the Symbol font. */
const SYMBOLS: Record<string, string> = {
  theta: 'θ', Delta: 'Δ', pi: 'π', mu: 'μ', Sigma: 'Σ', alpha: 'α', approx: '≈', cdot: '\u22C5', sqrt: '\u221A', times: '×', minus: '−', le: '≤', ge: '≥', infty: '∞', omega: 'ω',
};

class Deck {
  doc!: PDFDocument;
  f!: Fonts;
  n = 0;
  static async create(title: string): Promise<Deck> {
    const d = new Deck();
    d.doc = await PDFDocument.create();
    d.doc.setTitle(title);
    d.doc.setAuthor('petu synthetic deck');
    d.doc.setCreator('scripts/make-decks.ts');
    d.doc.setProducer('pdf-lib');
    const t = new Date('2026-10-28T00:00:00Z');
    d.doc.setCreationDate(t);
    d.doc.setModificationDate(t);
    d.f = {
      sans: await d.doc.embedFont(StandardFonts.Helvetica),
      bold: await d.doc.embedFont(StandardFonts.HelveticaBold),
      serif: await d.doc.embedFont(StandardFonts.TimesRoman),
      italic: await d.doc.embedFont(StandardFonts.TimesRomanItalic),
      sym: await d.doc.embedFont(StandardFonts.Symbol),
    };
    return d;
  }
  page(heading?: string): PDFPage {
    const p = this.doc.addPage([W, H]);
    this.n++;
    if (heading) this.text(p, heading, 40, 56, 26, this.f.bold);
    this.text(p, String(this.n), 750, 530, 13, this.f.sans, GRAY);
    return p;
  }

  text(p: PDFPage, s: string, x: number, y: number, size: number, font = this.f.sans, color: RGB = INK): number {
    p.drawText(s, { x, y: H - y, size, font, color });
    return font.widthOfTextAtSize(s, size);
  }
  bullets(p: PDFPage, lines: string[], y = 100, size = 17, x = 40, gap = 30): void {
    lines.forEach((s, i) => this.text(p, s, x, y + gap * i, size, this.f.sans, BODY));
  }

  /**
   * One line of math: `_x` / `_{..}` subscripts, `^x` / `^{..}` superscripts, `\name` symbols,
   * `|` nothing. Letters in italic serif, digits and operators upright. Returns the width.
   */
  math(p: PDFPage, src: string, x: number, y: number, size: number, color: RGB = INK, measure = false): number {
    let cx = x;
    const put = (s: string, font: PDFFont, sz: number, dy: number) => {
      if (!s) return;
      if (!measure) p.drawText(s, { x: cx, y: H - (y + dy), size: sz, font, color });
      cx += font.widthOfTextAtSize(s, sz);
    };
    const run = (s: string, sz: number, dy: number) => {
      let i = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '\\') {
          const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
          if (m && SYMBOLS[m[1]]) { put(SYMBOLS[m[1]], this.f.sym, sz, dy); i += m[0].length; continue; }
        }
        if ((c === '_' || c === '^') && i + 1 < s.length) {
          let arg: string;
          if (s[i + 1] === '{') { const j = s.indexOf('}', i); arg = s.slice(i + 2, j); i = j + 1; }
          else { arg = s[i + 1]; i += 2; }
          run(arg, sz * 0.68, dy + (c === '_' ? sz * 0.22 : -sz * 0.38));
          continue;
        }
        let j = i;
        const letter = /[A-Za-z]/.test(c);
        while (j < s.length && s[j] !== '\\' && s[j] !== '_' && s[j] !== '^' && /[A-Za-z]/.test(s[j]) === letter) j++;
        let chunk = s.slice(i, j);
        if (!letter) chunk = chunk.replace(/-/g, '–');
        // Variables (one letter, or two like mg, dx) go italic; words and units (sin, max, kg, TR) upright.
        const italic = letter && chunk.length <= 2 && !/^(kg|TR|CS|PS|at|to|of)$/.test(chunk);
        put(chunk, italic ? this.f.italic : this.f.serif, sz, dy);
        i = j;
      }
    };
    run(src, size, 0);
    return cx - x;
  }
  /** A stacked fraction centred on the math axis at baseline y. Returns its width. */
  frac(p: PDFPage, num: string, den: string, x: number, y: number, size: number, color: RGB = INK): number {
    const s = size * 0.85;
    const wn = this.math(p, num, 0, 0, s, color, true), wd = this.math(p, den, 0, 0, s, color, true);
    const w = Math.max(wn, wd) + 6;
    const axis = y - size * 0.3;
    this.math(p, num, x + (w - wn) / 2, axis - 4, s, color);
    this.math(p, den, x + (w - wd) / 2, axis + s * 0.85 + 2, s, color);
    this.line(p, [x, axis], [x + w, axis], 0.9, color);
    return w;
  }
  /** A display equation: strings are math runs, [num, den] pairs are fractions. */
  eq(p: PDFPage, parts: (string | [string, string])[], x: number, y: number, size = 20, color: RGB = INK): number {
    let cx = x;
    for (const part of parts) cx += typeof part === 'string' ? this.math(p, part, cx, y, size, color) : this.frac(p, part[0], part[1], cx + 2, y, size, color) + 4;
    return cx - x;
  }

  line(p: PDFPage, a: Pt, b: Pt, thickness = 1.2, color: RGB = INK, dash?: number[]): void {
    p.drawLine({ start: { x: a[0], y: H - a[1] }, end: { x: b[0], y: H - b[1] }, thickness, color, ...(dash ? { dashArray: dash } : {}) });
  }
  arrow(p: PDFPage, a: Pt, b: Pt, thickness = 1.4, color: RGB = INK, head = 9): void {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const back: Pt = [b[0] - Math.cos(ang) * head * 0.8, b[1] - Math.sin(ang) * head * 0.8];
    this.line(p, a, back, thickness, color);
    const l: Pt = [b[0] - head * Math.cos(ang - 0.4), b[1] - head * Math.sin(ang - 0.4)];
    const r: Pt = [b[0] - head * Math.cos(ang + 0.4), b[1] - head * Math.sin(ang + 0.4)];
    this.poly(p, [b, l, r], color);
  }
  dot(p: PDFPage, x: number, y: number, r = 4, color: RGB = INK): void { p.drawCircle({ x, y: H - y, size: r, color }); }
  ring(p: PDFPage, x: number, y: number, r: number, color: RGB = INK, thickness = 1.4, fill?: RGB): void {
    p.drawCircle({ x, y: H - y, size: r, borderColor: color, borderWidth: thickness, ...(fill ? { color: fill } : {}) });
  }
  poly(p: PDFPage, pts: Pt[], fill?: RGB, stroke?: RGB, width = 1.2): void {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ') + ' Z';
    p.drawSvgPath(d, { x: 0, y: H, ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: width } : {}) });
  }
  path(p: PDFPage, pts: Pt[], color: RGB = INK, width = 2, dash?: number[]): void {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    p.drawSvgPath(d, { x: 0, y: H, borderColor: color, borderWidth: width, ...(dash ? { borderDashArray: dash } : {}) });
  }
  rect(p: PDFPage, x: number, y: number, w: number, h: number, fill?: RGB, stroke?: RGB, width = 1.2): void {
    p.drawRectangle({ x, y: H - y - h, width: w, height: h, ...(fill ? { color: fill } : {}), ...(stroke ? { borderColor: stroke, borderWidth: width } : {}) });
  }

  /**
   * Axes in a box (top-left x,y, size w,h) for data x in [0,xmax], y in [0,ymax]. Draws the axes with
   * arrowheads, labels and ticks; returns the data → page mapper.
   */
  axes(p: PDFPage, o: { x: number; y: number; w: number; h: number; xmax: number; ymax: number; xLabel: string; yLabel: string; xTicks?: number[]; yTicks?: number[]; size?: number }): (dx: number, dy: number) => Pt {
    const ox = o.x, oy = o.y + o.h;
    const map = (dx: number, dy: number): Pt => [ox + (dx / o.xmax) * o.w, oy - (dy / o.ymax) * o.h];
    const s = o.size ?? 13;
    this.arrow(p, [ox, oy], [ox + o.w + 14, oy], 1.2, INK, 8);
    this.arrow(p, [ox, oy], [ox, o.y - 14], 1.2, INK, 8);
    this.math(p, o.xLabel, ox + o.w + 18, oy + 5, s + 2);
    this.math(p, o.yLabel, ox - 6, o.y - 20, s + 2);
    for (const t of o.xTicks ?? []) {
      const [px] = map(t, 0);
      this.line(p, [px, oy], [px, oy + 5], 1, INK);
      const lab = String(t), w = this.f.sans.widthOfTextAtSize(lab, s - 2);
      this.text(p, lab, px - w / 2, oy + 18, s - 2, this.f.sans, GRAY);
    }
    for (const t of o.yTicks ?? []) {
      const [, py] = map(0, t);
      this.line(p, [ox - 5, py], [ox, py], 1, INK);
      const lab = String(t), w = this.f.sans.widthOfTextAtSize(lab, s - 2);
      this.text(p, lab, ox - 9 - w, py + 4, s - 2, this.f.sans, GRAY);
    }
    return map;
  }
  /** Samples f over [a,b] and draws it through `map`. */
  plot(p: PDFPage, map: (x: number, y: number) => Pt, f: (x: number) => number, a: number, b: number, color: RGB = BLUE, width = 2.2, dash?: number[]): void {
    const pts: Pt[] = [];
    for (let i = 0; i <= 80; i++) { const x = a + ((b - a) * i) / 80; pts.push(map(x, f(x))); }
    this.path(p, pts, color, width, dash);
  }
  /** Dashed guides from a data point down to the x axis and across to the y axis. */
  guides(p: PDFPage, map: (x: number, y: number) => Pt, x: number, y: number, color: RGB = GRAY): void {
    const pt = map(x, y), x0 = map(x, 0), y0 = map(0, y);
    this.line(p, pt, x0, 0.9, color, [4, 3]);
    this.line(p, pt, y0, 0.9, color, [4, 3]);
  }
  label(p: PDFPage, s: string, at: Pt, dx = 8, dy = -8, size = 15, color: RGB = INK): void { this.math(p, s, at[0] + dx, at[1] + dy, size, color); }

  async save(file: string): Promise<void> {
    mkdirSync('public/fixtures', { recursive: true });
    writeFileSync(file, await this.doc.save({ useObjectStreams: false }));
    console.log('wrote', file, `(${this.n} pages)`);
  }
}

// ---------------------------------------------------------------------------------------------
// Deck 1: intro microeconomics. Demand Q_d = 60 - 5P (P = 12 - Q/5), supply Q_s = -10 + 5P
// (P = 2 + Q/5); equilibrium P* = 7, Q* = 25. Every number on the slides follows from these.
async function econ(): Promise<void> {
  const d = await Deck.create('Intro Microeconomics - Supply, Demand and Elasticity (sample deck)');
  const { f } = d;
  const demand = (q: number) => 12 - q / 5;
  const supply = (q: number) => 2 + q / 5;
  const box = { x: 90, y: 150, w: 330, h: 300, xmax: 60, ymax: 14, xLabel: 'Q', yLabel: 'P', xTicks: [10, 20, 30, 40, 50, 60], yTicks: [2, 4, 6, 8, 10, 12, 14] };

  { // 1 title
    const p = d.page();
    d.text(p, 'Supply, Demand and Elasticity', 60, 240, 38, f.bold);
    d.text(p, 'ECON 101 - Lecture 4', 60, 282, 20, f.sans, GRAY);
    d.text(p, 'How prices form in a competitive market, and how strongly quantities respond', 60, 330, 15, f.sans, BODY);
  }
  { // 2 demand curve
    const p = d.page('The Law of Demand');
    d.bullets(p, ['- Other things equal, a higher price', '  means a lower quantity demanded', '- The demand curve slopes downward'], 110, 16, 470, 26);
    d.eq(p, ['Q_d = 60 - 5P'], 490, 230, 22);
    d.text(p, 'Demand schedule', 490, 290, 14, f.bold);
    const rows = [['P', 'Q_d'], ['12', '0'], ['10', '10'], ['8', '20'], ['4', '40'], ['0', '60']];
    rows.forEach((r, i) => { d.math(p, r[0], 500, 316 + i * 22, 14, i ? BODY : INK); d.math(p, r[1], 570, 316 + i * 22, 14, i ? BODY : INK); });
    d.line(p, [490, 322], [620, 322], 0.8, GRAY);
    const m = d.axes(p, box);
    d.plot(p, m, demand, 0, 60, BLUE);
    for (const [q, pr, n] of [[20, 8, 'A'], [40, 4, 'B']] as const) { d.guides(p, m, q, pr); d.dot(p, ...m(q, pr), 4.5); d.label(p, n, m(q, pr), 9, -9, 16); }
    d.label(p, 'D', m(58, demand(58)), 6, -10, 16, BLUE);
  }
  { // 3 movement vs shift
    const p = d.page('Movement Along vs. Shift of Demand');
    const L = d.axes(p, { x: 70, y: 140, w: 270, h: 230, xmax: 60, ymax: 14, xLabel: 'Q', yLabel: 'P' });
    d.plot(p, L, demand, 0, 60, BLUE);
    d.dot(p, ...L(20, 8)); d.dot(p, ...L(40, 4));
    d.arrow(p, L(22, 7.2), L(37, 4.4), 1.6, RED);
    d.label(p, 'D', L(58, demand(58)), 6, -10, 15, BLUE);
    d.text(p, 'Price falls: move along D', 70, 420, 14, f.bold, BODY);
    const R = d.axes(p, { x: 440, y: 140, w: 270, h: 230, xmax: 60, ymax: 14, xLabel: 'Q', yLabel: 'P' });
    d.plot(p, R, demand, 0, 60, BLUE);
    d.plot(p, R, (q) => 14 - q / 5, 0, 60, BLUE, 2.2, [6, 4]);
    d.arrow(p, R(18, demand(18)), R(28, demand(18)), 1.6, RED);
    d.label(p, 'D_1', R(55, demand(55)), 6, -10, 15, BLUE);
    d.label(p, 'D_2', R(56, 14 - 56 / 5), 6, -12, 15, BLUE);
    d.text(p, 'Income rises: D shifts right', 440, 420, 14, f.bold, BODY);
    d.text(p, 'Shifters: income, prices of related goods, tastes, expectations, number of buyers', 40, 470, 14, f.sans, BODY);
  }
  { // 4 supply
    const p = d.page('The Law of Supply');
    d.bullets(p, ['- A higher price makes it worth', '  producing more', '- The supply curve slopes upward', '- Its intercept is the lowest price', '  at which anyone sells'], 110, 16, 470, 26);
    d.eq(p, ['Q_s = -10 + 5P'], 490, 280, 22);
    const m = d.axes(p, box);
    d.plot(p, m, supply, 0, 60, RED);
    for (const [q, pr, n] of [[10, 4, 'C'], [30, 8, 'D']] as const) { d.guides(p, m, q, pr); d.dot(p, ...m(q, pr), 4.5); d.label(p, n, m(q, pr), -18, -8, 16); }
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
  }
  { // 5 equilibrium
    const p = d.page('Market Equilibrium');
    const m = d.axes(p, box);
    d.plot(p, m, demand, 0, 60, BLUE);
    d.plot(p, m, supply, 0, 60, RED);
    d.guides(p, m, 25, 7);
    d.dot(p, ...m(25, 7), 5);
    d.label(p, 'E', m(25, 7), 10, -4, 17);
    d.label(p, 'D', m(58, demand(58)), 6, -10, 16, BLUE);
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
    d.text(p, 'Quantity demanded = quantity supplied', 470, 120, 16, f.bold, BODY);
    d.eq(p, ['Q_d = Q_s'], 490, 170, 21);
    d.eq(p, ['60 - 5P = -10 + 5P'], 490, 210, 21);
    d.eq(p, ['P* = 7,   Q* = 25'], 490, 250, 21);
    d.bullets(p, ['- No pressure for the price to change', '- Every buyer willing to pay P* buys'], 310, 15, 470, 24);
  }
  { // 6 surplus and shortage
    const p = d.page('Surplus and Shortage');
    const m = d.axes(p, box);
    d.plot(p, m, demand, 0, 60, BLUE);
    d.plot(p, m, supply, 0, 60, RED);
    d.line(p, m(0, 9), m(50, 9), 1.2, INK, [5, 3]);
    d.line(p, m(0, 5), m(50, 5), 1.2, INK, [5, 3]);
    d.dot(p, ...m(15, 9)); d.dot(p, ...m(35, 9)); d.dot(p, ...m(35, 5)); d.dot(p, ...m(15, 5));
    d.rect(p, m(15, 9)[0], m(15, 9)[1] - 3, m(35, 9)[0] - m(15, 9)[0], 6, TINT_G);
    d.rect(p, m(15, 5)[0], m(15, 5)[1] - 3, m(35, 5)[0] - m(15, 5)[0], 6, TINT_R);
    d.text(p, 'surplus', m(20, 9)[0], m(20, 9)[1] - 10, 13, f.sans, GREEN);
    d.text(p, 'shortage', m(20, 5)[0], m(20, 5)[1] + 20, 13, f.sans, RED);
    d.label(p, 'D', m(58, demand(58)), 6, -10, 16, BLUE);
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
    d.text(p, 'Price above P* = 7', 470, 120, 16, f.bold, BODY);
    d.eq(p, ['P = 9:   Q_d = 15,  Q_s = 35'], 480, 152, 18);
    d.text(p, 'Surplus of 20: sellers cut prices', 480, 180, 14, f.sans, BODY);
    d.text(p, 'Price below P*', 470, 240, 16, f.bold, BODY);
    d.eq(p, ['P = 5:   Q_d = 35,  Q_s = 15'], 480, 272, 18);
    d.text(p, 'Shortage of 20: buyers bid prices up', 480, 300, 14, f.sans, BODY);
  }
  { // 7 demand increase
    const p = d.page('An Increase in Demand');
    const m = d.axes(p, box);
    const d2 = (q: number) => 15 - q / 5;
    d.plot(p, m, demand, 0, 60, BLUE);
    d.plot(p, m, d2, 0, 60, BLUE, 2.2, [6, 4]);
    d.plot(p, m, supply, 0, 60, RED);
    d.dot(p, ...m(25, 7), 4.5); d.label(p, 'E_1', m(25, 7), 6, 18, 15);
    d.dot(p, ...m(32.5, 8.5), 4.5); d.label(p, 'E_2', m(32.5, 8.5), -6, -12, 15);
    d.guides(p, m, 32.5, 8.5);
    d.arrow(p, m(12, demand(12)), m(20, demand(12)), 1.5, GRAY);
    d.label(p, 'D_1', m(56, demand(56)), 4, -8, 15, BLUE);
    d.label(p, 'D_2', m(56, d2(56)), 4, -10, 15, BLUE);
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
    d.eq(p, ['Q_d = 75 - 5P'], 490, 140, 20);
    d.eq(p, ['75 - 5P = -10 + 5P'], 490, 180, 20);
    d.eq(p, ['P = 8.5,   Q = 32.5'], 490, 220, 20);
    d.bullets(p, ['- Both price and quantity rise', '- Supply did not shift: we moved', '  along S from'], 280, 15, 470, 24);
    d.math(p, 'E_1 to E_2', 595, 328, 15, BODY);
  }
  { // 8 price elasticity
    const p = d.page('Price Elasticity of Demand');
    d.bullets(p, ['- How strongly quantity responds to price, in percent', '- Midpoint method: same answer in either direction'], 100, 16);
    d.eq(p, ['E_d = ', ['%\\Delta Q', '%\\Delta P']], 60, 200, 24);
    d.eq(p, ['E_d = ', ['(Q_2 - Q_1) / [(Q_1 + Q_2)/2]', '(P_2 - P_1) / [(P_1 + P_2)/2]']], 330, 200, 22);
    d.rect(p, 40, 250, 720, 190, PANEL, GRAY, 0.8);
    d.text(p, 'Example: the price falls from 10 to 8', 60, 280, 16, f.bold, BODY);
    d.eq(p, ['%\\Delta Q = ', ['20 - 10', '15'], ' = 66.7%'], 70, 335, 20);
    d.eq(p, ['%\\Delta P = ', ['8 - 10', '9'], ' = -22.2%'], 70, 405, 20);
    d.eq(p, ['E_d = ', ['66.7%', '-22.2%'], ' = -3.0'], 430, 370, 22);
    d.eq(p, ['|E_d| > 1:  demand is elastic here'], 430, 420, 15, BODY);
  }
  { // 9 elasticity along a line
    const p = d.page('Elasticity Changes Along a Straight Line');
    const m = d.axes(p, box);
    d.plot(p, m, demand, 0, 30, RED, 3);
    d.plot(p, m, demand, 30, 60, GREEN, 3);
    d.dot(p, ...m(30, 6), 5);
    d.guides(p, m, 30, 6);
    d.label(p, 'M', m(30, 6), 10, -6, 16);
    d.text(p, 'elastic', m(8, 10.4)[0] + 12, m(8, 10.4)[1] - 6, 14, f.sans, RED);
    d.text(p, 'inelastic', m(46, 2.8)[0] + 8, m(46, 2.8)[1] - 8, 14, f.sans, GREEN);
    d.eq(p, ['E_d = ', ['\\Delta Q', '\\Delta P'], ' \\cdot ', ['P', 'Q'], ' = -5 ', ['P', 'Q']], 470, 140, 20);
    d.text(p, 'The slope is constant; P/Q is not.', 470, 200, 14, f.sans, BODY);
    d.eq(p, ['above M:   |E_d| > 1   (elastic)'], 470, 250, 16, BODY);
    d.eq(p, ['at M (Q = 30, P = 6):   |E_d| = 1'], 470, 280, 16, BODY);
    d.eq(p, ['below M:   |E_d| < 1   (inelastic)'], 470, 310, 16, BODY);
  }
  { // 10 total revenue
    const p = d.page('Elasticity and Total Revenue');
    const m = d.axes(p, { x: 80, y: 140, w: 280, h: 260, xmax: 60, ymax: 14, xLabel: 'Q', yLabel: 'P', xTicks: [10, 20, 30, 60], yTicks: [8, 10, 12] });
    const [x0, y0] = m(0, 0);
    const a = m(10, 10), b = m(20, 8);
    d.rect(p, x0, b[1], b[0] - x0, y0 - b[1], TINT_G);
    d.rect(p, x0, a[1], a[0] - x0, y0 - a[1], TINT_B, BLUE, 0.8);
    d.plot(p, m, demand, 0, 60, BLUE);
    d.dot(p, ...a); d.dot(p, ...b);
    d.label(p, 'TR = 100', m(0.8, 8.6), 0, 0, 12);
    d.label(p, 'TR = 160', m(10.8, 4), 0, 0, 12);
    const r = d.axes(p, { x: 470, y: 140, w: 260, h: 260, xmax: 60, ymax: 200, xLabel: 'Q', yLabel: 'TR', xTicks: [30, 60], yTicks: [100, 180] });
    d.plot(p, r, (q) => demand(q) * q, 0, 60, GREEN);
    d.dot(p, ...r(30, 180)); d.guides(p, r, 30, 180);
    d.eq(p, ['TR = P \\times Q'], 520, 470, 18);
    d.eq(p, ['TR peaks where |E_d| = 1'], 470, 500, 15, BODY);
  }
  { // 11 consumer and producer surplus
    const p = d.page('Consumer and Producer Surplus');
    const m = d.axes(p, box);
    d.poly(p, [m(0, 12), m(25, 7), m(0, 7)], TINT_B);
    d.poly(p, [m(0, 7), m(25, 7), m(0, 2)], TINT_R);
    d.plot(p, m, demand, 0, 60, BLUE);
    d.plot(p, m, supply, 0, 60, RED);
    d.line(p, m(0, 7), m(25, 7), 1, GRAY, [4, 3]);
    d.dot(p, ...m(25, 7), 4.5);
    d.label(p, 'CS', m(5, 8.6), 0, 4, 15, BLUE);
    d.label(p, 'PS', m(5, 5.2), 0, 4, 15, RED);
    d.label(p, 'D', m(58, demand(58)), 6, -10, 16, BLUE);
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
    d.text(p, 'Area between price and each curve', 470, 120, 15, f.bold, BODY);
    d.eq(p, ['CS = ', ['1', '2'], ' \\times 25 \\times (12 - 7) = 62.5'], 480, 175, 18);
    d.eq(p, ['PS = ', ['1', '2'], ' \\times 25 \\times (7 - 2) = 62.5'], 480, 235, 18);
    d.bullets(p, ['- CS: what buyers would pay minus', '  what they pay', '- PS: what sellers receive minus', '  their lowest acceptable price'], 290, 15, 470, 24);
  }
  { // 12 tax wedge
    const p = d.page('A Per-Unit Tax and Deadweight Loss');
    const m = d.axes(p, box);
    const st = (q: number) => 4 + q / 5;
    d.poly(p, [m(20, 8), m(25, 7), m(20, 6)], TINT_R, RED, 0.8);
    d.rect(p, m(0, 8)[0], m(0, 8)[1], m(20, 8)[0] - m(0, 8)[0], m(20, 6)[1] - m(20, 8)[1], TINT_G);
    d.plot(p, m, demand, 0, 60, BLUE);
    d.plot(p, m, supply, 0, 60, RED);
    d.plot(p, m, st, 0, 50, RED, 2.2, [6, 4]);
    d.line(p, m(20, 0), m(20, 8), 0.9, GRAY, [4, 3]);
    d.dot(p, ...m(20, 8)); d.dot(p, ...m(20, 6)); d.dot(p, ...m(25, 7), 3.5, GRAY);
    d.label(p, 'P_b = 8', m(20, 8), -60, -6, 14);
    d.label(p, 'P_s = 6', m(20, 6), -60, 18, 14);
    d.label(p, 'S + t', m(48, st(48)), 6, -6, 15, RED);
    d.label(p, 'S', m(58, supply(58)), 6, 4, 16, RED);
    d.label(p, 'D', m(58, demand(58)), 6, -10, 16, BLUE);
    d.label(p, 'DWL', m(27, 7.6), 10, -12, 13, RED);
    d.eq(p, ['t = 2:    60 - 5P_b = -10 + 5(P_b - 2)'], 470, 140, 17);
    d.eq(p, ['P_b = 8,   P_s = 6,   Q = 20'], 470, 180, 17);
    d.eq(p, ['revenue = t \\times Q = 40'], 470, 230, 17, GREEN);
    d.eq(p, ['DWL = ', ['1', '2'], ' \\times 2 \\times (25 - 20) = 5'], 470, 285, 17, RED);
    d.bullets(p, ['- Buyers and sellers split the tax', '- Trades between Q = 20 and 25 vanish'], 340, 15, 470, 24);
  }
  await d.save('public/fixtures/econ.pdf');
}

// ---------------------------------------------------------------------------------------------
// Deck 2: intro mechanics. g = 9.8 m/s^2 throughout.
async function mechanics(): Promise<void> {
  const d = await Deck.create('Intro Mechanics - Motion and Forces (sample deck)');
  const { f } = d;
  const g = 9.8;
  const rad = (deg: number) => (deg * Math.PI) / 180;

  { // 1 title
    const p = d.page();
    d.text(p, 'Motion and Forces', 60, 240, 40, f.bold);
    d.text(p, 'PHYS 101 - Lecture 3', 60, 282, 20, f.sans, GRAY);
    d.text(p, 'Kinematics, projectiles, Newton\'s laws, friction, circular motion, work', 60, 330, 15, f.sans, BODY);
  }
  { // 2 position and velocity
    const p = d.page('Velocity Is the Slope of x(t)');
    const m = d.axes(p, { x: 90, y: 140, w: 320, h: 300, xmax: 4, ymax: 16, xLabel: 't (s)', yLabel: 'x (m)', xTicks: [1, 2, 3, 4], yTicks: [4, 8, 12, 16] });
    d.plot(p, m, (t) => t * t, 0, 4, BLUE);
    d.plot(p, m, (t) => 4 * t - 4, 1, 3.6, RED, 1.6);
    d.line(p, m(1, 1), m(3, 9), 1.2, GREEN, [5, 3]);
    d.dot(p, ...m(2, 4), 4.5); d.label(p, 'P', m(2, 4), -20, -6, 15);
    d.dot(p, ...m(1, 1)); d.dot(p, ...m(3, 9));
    d.label(p, 'tangent', m(3.4, 9.6), 6, 8, 13, RED);
    d.label(p, 'secant', m(2.4, 5.8), -64, -4, 13, GREEN);
    d.eq(p, ['x(t) = t^2'], 480, 130, 21);
    d.eq(p, ['v_{avg} = ', ['\\Delta x', '\\Delta t'], ' = ', ['9 - 1', '3 - 1'], ' = 4 m/s'], 480, 190, 19);
    d.eq(p, ['v = ', ['dx', 'dt'], ' = 2t'], 480, 260, 20);
    d.text(p, 'At P (t = 2 s): v = 4 m/s', 480, 310, 15, f.sans, BODY);
    d.text(p, 'The secant tends to the tangent as', 480, 350, 14, f.sans, BODY);
    d.text(p, 'the interval shrinks.', 480, 370, 14, f.sans, BODY);
  }
  { // 3 constant acceleration
    const p = d.page('Constant Acceleration');
    const m = d.axes(p, { x: 90, y: 140, w: 320, h: 300, xmax: 4, ymax: 16, xLabel: 't (s)', yLabel: 'v (m/s)', xTicks: [1, 2, 3, 4], yTicks: [2, 8, 14] });
    d.poly(p, [m(0, 0), m(0, 2), m(4, 14), m(4, 0)], TINT_B);
    d.plot(p, m, (t) => 2 + 3 * t, 0, 4, BLUE);
    d.line(p, m(0, 2), m(4, 2), 0.9, GRAY, [4, 3]);
    d.label(p, 'area = displacement', m(1.2, 4.5), 0, 0, 13, BLUE);
    d.label(p, 'slope a = 3 m/s^2', m(1.7, 10.6), -40, -8, 13);
    d.eq(p, ['v = v_0 + at'], 480, 130, 20);
    d.eq(p, ['x = x_0 + v_0t + ', ['1', '2'], 'at^2'], 480, 180, 20);
    d.eq(p, ['v^2 = v_0^2 + 2a(x - x_0)'], 480, 240, 20);
    d.eq(p, ['v_0 = 2 m/s,  a = 3 m/s^2,  t = 4 s:'], 480, 300, 15, BODY);
    d.eq(p, ['\\Delta x = 2 \\cdot 4 + ', ['1', '2'], '\\cdot 3 \\cdot 4^2 = 32 m'], 480, 340, 18);
  }
  { // 4 vector components
    const p = d.page('Resolving a Vector into Components');
    const O: Pt = [140, 420];
    const v = 20, th = 30, k = 13;
    const tip: Pt = [O[0] + v * Math.cos(rad(th)) * k, O[1] - v * Math.sin(rad(th)) * k];
    d.arrow(p, O, [O[0] + 330, O[1]], 1, GRAY, 7);
    d.arrow(p, O, [O[0], O[1] - 230], 1, GRAY, 7);
    d.arrow(p, O, [tip[0], O[1]], 2, RED);
    d.arrow(p, [tip[0], O[1]], tip, 2, GREEN);
    d.arrow(p, O, tip, 2.6, BLUE);
    d.path(p, Array.from({ length: 13 }, (_, i) => { const a = rad((th * i) / 12); return [O[0] + 50 * Math.cos(a), O[1] - 50 * Math.sin(a)] as Pt; }), INK, 1.2);
    d.label(p, '\\theta', O, 58, -8, 16);
    d.label(p, 'v', [(O[0] + tip[0]) / 2, (O[1] + tip[1]) / 2], -14, -10, 18, BLUE);
    d.label(p, 'v_x', [(O[0] + tip[0]) / 2, O[1]], -8, 22, 16, RED);
    d.label(p, 'v_y', [tip[0], (O[1] + tip[1]) / 2], 8, 4, 16, GREEN);
    d.eq(p, ['v_x = v cos \\theta'], 520, 140, 21);
    d.eq(p, ['v_y = v sin \\theta'], 520, 185, 21);
    d.eq(p, ['v = \\sqrt(v_x^2 + v_y^2)'], 520, 230, 21);
    d.text(p, 'Example: v = 20 m/s at 30 degrees', 520, 290, 14, f.bold, BODY);
    d.eq(p, ['v_x = 20 cos 30° = 17.3 m/s'], 520, 325, 17);
    d.eq(p, ['v_y = 20 sin 30° = 10 m/s'], 520, 360, 17);
  }
  { // 5 projectile
    const p = d.page('Projectile Motion');
    const v0 = 20, th = rad(45);
    const R = (v0 * v0 * Math.sin(2 * th)) / g, Hm = (v0 * v0 * Math.sin(th) ** 2) / (2 * g);
    const m = d.axes(p, { x: 70, y: 150, w: 440, h: 230, xmax: 45, ymax: 14, xLabel: 'x (m)', yLabel: 'y (m)', xTicks: [10, 20, 30, 40], yTicks: [5, 10] });
    const yOf = (x: number) => x * Math.tan(th) - (g * x * x) / (2 * v0 * v0 * Math.cos(th) ** 2);
    d.plot(p, m, yOf, 0, R, BLUE, 2.4);
    const vx = v0 * Math.cos(th), s = 1.6;
    for (const x of [0, R / 2, R * 0.85]) {
      const t = x / vx, vy = v0 * Math.sin(th) - g * t;
      const a = m(x, yOf(x));
      d.arrow(p, a, [a[0] + vx * s * 2.2, a[1]], 1.5, RED, 7);
      if (Math.abs(vy) > 0.5) d.arrow(p, a, [a[0], a[1] - vy * s * 2.2], 1.5, GREEN, 7);
      d.dot(p, ...a, 3.5);
    }
    d.guides(p, m, R / 2, Hm);
    d.label(p, 'H', m(R / 2, Hm / 2), 6, 0, 16);
    d.label(p, 'R', m(R, 0), 6, -8, 16);
    d.label(p, 'v_x', m(R / 2, Hm), 16, 18, 14, RED);
    d.eq(p, ['v_0 = 20 m/s,  \\theta = 45\u00B0'], 560, 140, 15, BODY);
    d.bullets(p, ['- Horizontal: no force,', '- Vertical: gravity only,', '- At the top:'], 180, 14, 560, 46);
    d.eq(p, ['v_x stays constant'], 572, 203, 15, BODY);
    d.eq(p, ['a = -g, v_y shrinks, flips sign'], 572, 249, 15, BODY);
    d.eq(p, ['v_y = 0'], 572, 295, 15, BODY);
    d.eq(p, ['x = v_0 cos \\theta \\cdot t'], 80, 445, 18);
    d.eq(p, ['y = v_0 sin \\theta \\cdot t - ', ['1', '2'], 'gt^2'], 330, 445, 18);
  }
  { // 6 range vs angle
    const p = d.page('Range Depends on the Launch Angle');
    const v0 = 20;
    const m = d.axes(p, { x: 90, y: 150, w: 330, h: 280, xmax: 90, ymax: 45, xLabel: '\\theta (deg)', yLabel: 'R (m)', xTicks: [15, 30, 45, 60, 75, 90], yTicks: [10, 20, 30, 40] });
    d.plot(p, m, (a) => (v0 * v0 * Math.sin(2 * rad(a))) / g, 0, 90, BLUE);
    const r30 = (v0 * v0 * Math.sin(rad(60))) / g;
    d.dot(p, ...m(45, (v0 * v0) / g), 4.5); d.guides(p, m, 45, (v0 * v0) / g);
    d.dot(p, ...m(30, r30)); d.dot(p, ...m(60, r30));
    d.line(p, m(30, r30), m(60, r30), 1, GRAY, [4, 3]);
    d.label(p, 'max', m(45, (v0 * v0) / g), 8, -8, 14);
    d.eq(p, ['R = ', ['v_0^2 sin 2\\theta', 'g']], 490, 150, 22);
    d.eq(p, ['H = ', ['v_0^2 sin^2 \\theta', '2g']], 490, 230, 22);
    d.bullets(p, ['- R is largest at 45 degrees', '- 30 and 60 degrees land at the', '  same spot (35.3 m)', '- Steeper launches go higher'], 300, 15, 470, 24);
  }
  { // 7 newton + FBD
    const p = d.page('Newton\'s Second Law and Free-Body Diagrams');
    d.rect(p, 70, 330, 340, 6, GRAY);
    d.rect(p, 180, 250, 110, 80, PANEL, INK, 1.4);
    d.text(p, 'm', 228, 296, 18, f.serif);
    const c: Pt = [235, 290];
    d.arrow(p, [290, 290], [390, 290], 2.2, BLUE); d.label(p, 'F', [390, 290], 4, -8, 17, BLUE);
    d.arrow(p, [180, 318], [110, 318], 2.2, RED); d.label(p, 'f', [110, 318], -16, -8, 17, RED);
    d.arrow(p, [235, 250], [235, 175], 2.2, GREEN); d.label(p, 'N', [235, 175], 8, 4, 17, GREEN);
    d.arrow(p, c, [235, 410], 2.2, INK); d.label(p, 'mg', [235, 410], 8, 0, 17);
    d.eq(p, ['\\Sigma F = ma'], 480, 130, 24);
    d.eq(p, ['F - f = ma'], 490, 190, 19);
    d.eq(p, ['N - mg = 0'], 490, 225, 19);
    d.text(p, 'Example: m = 5 kg, F = 30 N, f = 10 N', 480, 280, 14, f.bold, BODY);
    d.eq(p, ['a = ', ['30 - 10', '5'], ' = 4 m/s^2'], 490, 325, 19);
    d.bullets(p, ['- Draw every force on one body', '- Sum each direction separately'], 380, 14, 480, 22);
  }
  { // 8 incline
    const p = d.page('A Block on an Inclined Plane');
    const A: Pt = [70, 440], B: Pt = [470, 440];
    const th = rad(30);
    const C: Pt = [470, 440 - 400 * Math.tan(th)];
    d.poly(p, [A, B, C], PANEL, INK, 1.4);
    d.path(p, Array.from({ length: 13 }, (_, i) => { const a = rad((30 * i) / 12); return [A[0] + 60 * Math.cos(a), A[1] - 60 * Math.sin(a)] as Pt; }), INK, 1.2);
    d.label(p, '\\theta', A, 66, -6, 16);
    const u: Pt = [Math.cos(th), -Math.sin(th)], nrm: Pt = [Math.sin(th), Math.cos(th)];
    const base: Pt = [A[0] + 230 * u[0], A[1] + 230 * u[1]];
    const s = 56;
    const corners: Pt[] = [base, [base[0] + s * u[0], base[1] + s * u[1]], [base[0] + s * u[0] - s * nrm[0], base[1] + s * u[1] - s * nrm[1]], [base[0] - s * nrm[0], base[1] - s * nrm[1]]];
    d.poly(p, corners, hex('#ffffff'), INK, 1.4);
    const cm: Pt = [base[0] + (s / 2) * u[0] - (s / 2) * nrm[0], base[1] + (s / 2) * u[1] - (s / 2) * nrm[1]];
    d.arrow(p, cm, [cm[0], cm[1] + 120], 2.2, INK); d.label(p, 'mg', [cm[0], cm[1] + 120], 6, 0, 16);
    const along = 120 * Math.sin(th), perp = 120 * Math.cos(th);
    d.arrow(p, cm, [cm[0] - along * u[0], cm[1] - along * u[1]], 1.8, RED); d.label(p, 'mg sin \\theta', [cm[0] - along * u[0], cm[1] - along * u[1]], -92, 4, 14, RED);
    d.arrow(p, cm, [cm[0] + perp * nrm[0], cm[1] + perp * nrm[1]], 1.8, BLUE); d.label(p, 'mg cos \\theta', [cm[0] + perp * nrm[0], cm[1] + perp * nrm[1]], 8, 10, 14, BLUE);
    d.arrow(p, cm, [cm[0] - perp * nrm[0], cm[1] - perp * nrm[1]], 1.8, GREEN); d.label(p, 'N', [cm[0] - perp * nrm[0], cm[1] - perp * nrm[1]], -6, -8, 16, GREEN);
    d.eq(p, ['N = mg cos \\theta'], 540, 140, 20);
    d.eq(p, ['a = g sin \\theta'], 540, 185, 20);
    d.text(p, '(frictionless)', 540, 210, 13, f.sans, GRAY);
    d.text(p, 'At 30 degrees:', 540, 260, 14, f.bold, BODY);
    d.eq(p, ['a = 9.8 \\times 0.5 = 4.9 m/s^2'], 540, 295, 16);
    d.bullets(p, ['- Tilt the axes with the slope', '- Only mg has components', '  in both directions'], 340, 14, 540, 22);
  }
  { // 9 friction
    const p = d.page('Static and Kinetic Friction');
    const m = d.axes(p, { x: 90, y: 150, w: 340, h: 260, xmax: 40, ymax: 30, xLabel: 'F_{applied} (N)', yLabel: 'f (N)', xTicks: [10, 20, 30, 40], yTicks: [10, 20, 30] });
    d.line(p, m(0, 0), m(24.5, 24.5), 2.4, BLUE);
    d.line(p, m(24.5, 24.5), m(24.5, 19.6), 1.2, BLUE, [4, 3]);
    d.line(p, m(24.5, 19.6), m(40, 19.6), 2.4, RED);
    d.dot(p, ...m(24.5, 24.5), 4.5);
    d.label(p, 'f_{s,max} = \\mu_s N', m(24.5, 24.5), -60, -14, 14, BLUE);
    d.label(p, 'f_k = \\mu_k N', m(32, 19.6), -10, 22, 14, RED);
    d.label(p, 'at rest', m(8, 8), 8, 8, 13, GRAY);
    d.label(p, 'sliding', m(30, 19.6), -6, -12, 13, GRAY);
    d.eq(p, ['f_s \\le \\mu_s N'], 500, 150, 20);
    d.eq(p, ['f_k = \\mu_k N'], 500, 195, 20);
    d.eq(p, ['m = 5 kg,  N = 49 N'], 500, 250, 15, BODY);
    d.eq(p, ['\\mu_s = 0.5,  \\mu_k = 0.4'], 500, 274, 15, BODY);
    d.bullets(p, ['- Static friction matches the push', '  until it reaches its maximum', '- Then the block slips and friction', '  drops to the kinetic value'], 320, 14, 480, 22);
  }
  { // 10 atwood
    const p = d.page('Two Masses over a Pulley');
    const cx = 230, cy = 140, r = 36;
    d.line(p, [cx - 120, 96], [cx + 120, 96], 3, INK);
    d.line(p, [cx, 96], [cx, cy], 1.4, INK);
    d.ring(p, cx, cy, r, INK, 2, PANEL);
    d.dot(p, cx, cy, 3);
    d.line(p, [cx - r, cy], [cx - r, 300], 1.4, INK);
    d.line(p, [cx + r, cy], [cx + r, 360], 1.4, INK);
    d.rect(p, cx - r - 30, 300, 60, 50, TINT_B, INK, 1.4); d.math(p, 'm_1', cx - r - 12, 332, 17);
    d.rect(p, cx + r - 35, 360, 70, 64, TINT_R, INK, 1.4); d.math(p, 'm_2', cx + r - 13, 398, 17);
    d.arrow(p, [cx - r - 50, 340], [cx - r - 50, 290], 1.6, BLUE); d.label(p, 'a', [cx - r - 50, 290], -16, 6, 15, BLUE);
    d.arrow(p, [cx + r + 50, 370], [cx + r + 50, 420], 1.6, RED); d.label(p, 'a', [cx + r + 50, 420], 8, 0, 15, RED);
    d.label(p, 'T', [cx - r, 240], -18, 0, 15); d.label(p, 'T', [cx + r, 260], 8, 0, 15);
    d.eq(p, ['m_2g - T = m_2a'], 480, 130, 19);
    d.eq(p, ['T - m_1g = m_1a'], 480, 170, 19);
    d.eq(p, ['a = ', ['(m_2 - m_1) g', 'm_1 + m_2']], 480, 235, 21);
    d.eq(p, ['T = ', ['2m_1m_2g', 'm_1 + m_2']], 480, 305, 21);
    d.eq(p, ['m_1 = 2 kg,  m_2 = 3 kg:'], 480, 370, 15, BODY);
    d.eq(p, ['a = 1.96 m/s^2,   T = 23.5 N'], 480, 400, 17);
  }
  { // 11 circular motion
    const p = d.page('Uniform Circular Motion');
    const cx = 230, cy = 290, r = 140;
    d.ring(p, cx, cy, r, GRAY, 1.4);
    d.dot(p, cx, cy, 3.5);
    const ang = rad(40);
    const P: Pt = [cx + r * Math.cos(ang), cy - r * Math.sin(ang)];
    d.line(p, [cx, cy], P, 1.2, GRAY, [5, 3]);
    d.label(p, 'r', [(cx + P[0]) / 2, (cy + P[1]) / 2], -14, -6, 16);
    d.dot(p, ...P, 5);
    d.arrow(p, P, [P[0] - 90 * Math.sin(ang), P[1] - 90 * Math.cos(ang)], 2.2, BLUE);
    d.label(p, 'v', [P[0] - 90 * Math.sin(ang), P[1] - 90 * Math.cos(ang)], -16, -4, 17, BLUE);
    d.arrow(p, P, [P[0] - 70 * Math.cos(ang), P[1] + 70 * Math.sin(ang)], 2.2, RED);
    d.label(p, 'a_c', [P[0] - 70 * Math.cos(ang), P[1] + 70 * Math.sin(ang)], -8, 22, 16, RED);
    d.eq(p, ['a_c = ', ['v^2', 'r']], 480, 150, 24);
    d.eq(p, ['F_c = ', ['mv^2', 'r']], 480, 225, 24);
    d.bullets(p, ['- Speed is constant, direction is not', '- a points to the centre', '- Some real force supplies it', '  (tension, friction, gravity)'], 290, 14, 470, 22);
    d.text(p, 'Car on a curve: v = 15 m/s, r = 50 m', 470, 410, 14, f.bold, BODY);
    d.eq(p, ['a_c = 225 / 50 = 4.5 m/s^2'], 470, 440, 17);
  }
  { // 12 work and energy
    const p = d.page('Work and Kinetic Energy');
    const m = d.axes(p, { x: 90, y: 150, w: 320, h: 250, xmax: 8, ymax: 30, xLabel: 'x (m)', yLabel: 'F (N)', xTicks: [2, 4, 6, 8], yTicks: [10, 20, 30] });
    d.poly(p, [m(0, 0), m(0, 20), m(6, 20), m(6, 0)], TINT_G);
    d.line(p, m(0, 20), m(6, 20), 2.4, GREEN);
    d.line(p, m(6, 20), m(6, 0), 1, GRAY, [4, 3]);
    d.label(p, 'W = 20 \\times 6 = 120 J', m(0.6, 9), 0, 0, 14, GREEN);
    d.eq(p, ['W = Fd cos \\theta'], 480, 140, 21);
    d.eq(p, ['KE = ', ['1', '2'], 'mv^2'], 480, 200, 21);
    d.eq(p, ['W_{net} = \\Delta KE'], 480, 260, 21);
    d.text(p, 'A 3 kg cart from rest, pushed', 480, 320, 14, f.bold, BODY);
    d.text(p, 'with 20 N over 6 m:', 480, 340, 14, f.bold, BODY);
    d.eq(p, ['120 = ', ['1', '2'], ' \\cdot 3 \\cdot v^2'], 480, 385, 18);
    d.eq(p, ['v = 8.9 m/s'], 480, 430, 18);
  }
  await d.save('public/fixtures/mechanics.pdf');
}

// ---------------------------------------------------------------------------------------------
// Deck 3: intro biology, enzyme kinetics. Michaelis–Menten with Vmax = 10, Km = 2; a competitive
// inhibitor at [I]/Ki = 1 doubles the apparent Km to 4 and leaves Vmax at 10. Quotable lines are
// drawn as single text runs so the locator finds them verbatim.
async function bio(): Promise<void> {
  const d = await Deck.create('Intro Biology - Enzyme Kinetics and Inhibition (sample deck)');
  const { f } = d;
  const Vmax = 10, Km = 2, ratio = 1;
  const mm = (km: number) => (s: number) => (Vmax * s) / (km + s);

  { // 1 title
    const p = d.page();
    d.text(p, 'Enzymes and Their Kinetics', 60, 240, 38, f.bold);
    d.text(p, 'BIO 110 - Lecture 7', 60, 282, 20, f.sans, GRAY);
    d.text(p, 'How enzymes speed up reactions, how fast they can go, and how inhibitors slow them', 60, 330, 15, f.sans, BODY);
  }
  { // 2 enzyme basics
    const p = d.page('Enzymes Bind Their Substrates');
    d.bullets(p, [
      'An enzyme binds its substrate at the active site',
      '- The active site is a pocket shaped to fit the substrate',
      '- Binding forms the enzyme-substrate complex ES',
      '- The enzyme converts S to product P and is released unchanged',
    ], 100, 16, 40, 28);
    // E + S <-> ES -> E + P, drawn as shapes
    const y = 330;
    const enzyme = (x: number) => d.poly(p, [[x, y - 40], [x + 90, y - 40], [x + 90, y + 40], [x, y + 40], [x, y + 12], [x + 30, y + 12], [x + 30, y - 12], [x, y - 12]], TINT_B, BLUE, 1.4);
    enzyme(70); d.text(p, 'E', 128, y + 6, 18, f.bold, BLUE);
    d.text(p, '+', 178, y + 6, 22, f.sans, INK);
    d.rect(p, 205, y - 12, 30, 24, TINT_G, GREEN, 1.4); d.text(p, 'S', 214, y + 6, 15, f.bold, GREEN);
    d.arrow(p, [255, y - 4], [315, y - 4], 1.6, INK, 8);
    d.arrow(p, [315, y + 6], [255, y + 6], 1.6, INK, 8);
    enzyme(335); d.rect(p, 335, y - 12, 30, 24, TINT_G, GREEN, 1.4);
    d.text(p, 'ES', 385, y + 6, 18, f.bold, BLUE);
    d.arrow(p, [440, y], [500, y], 1.6, INK, 8);
    enzyme(520); d.text(p, 'E', 578, y + 6, 18, f.bold, BLUE);
    d.text(p, '+', 628, y + 6, 22, f.sans, INK);
    d.ring(p, 670, y, 15, RED, 1.4, TINT_R); d.text(p, 'P', 665, y + 6, 15, f.bold, RED);
    d.text(p, 'active site', 72, y + 66, 13, f.sans, GRAY);
    d.text(p, 'enzyme-substrate complex', 330, y + 66, 13, f.sans, GRAY);
    d.text(p, 'The enzyme is a catalyst: it lowers the activation energy, not the overall energy change.', 40, 470, 14, f.sans, BODY);
  }
  { // 3 Michaelis-Menten curve
    const p = d.page('The Michaelis-Menten Curve');
    const m = d.axes(p, { x: 90, y: 140, w: 330, h: 290, xmax: 20, ymax: 12, xLabel: '[S]', yLabel: 'v', xTicks: [2, 5, 10, 15, 20], yTicks: [5, 10] });
    d.line(p, m(0, Vmax), m(20, Vmax), 1, GRAY, [5, 3]);
    d.plot(p, m, mm(Km), 0, 20, BLUE);
    d.guides(p, m, Km, Vmax / 2);
    d.dot(p, ...m(Km, Vmax / 2), 4.5);
    d.label(p, 'Vmax', m(20, Vmax), -40, -8, 14, GRAY);
    d.label(p, 'Vmax/2', m(Km, Vmax / 2), 8, -6, 13);
    d.text(p, 'v = Vmax [S] / (Km + [S])', 470, 140, 20, f.serif);
    d.bullets(p, [
      '- Low [S]: v rises almost linearly',
      '- High [S]: the active sites are full,',
      '  v levels off at Vmax',
      '- Km is the [S] that gives half of Vmax',
      '- A small Km means tight binding',
    ], 200, 15, 470, 26);
    d.text(p, 'Here Vmax = 10 and Km = 2: at [S] = 2, v = 5', 470, 360, 14, f.bold, BODY);
  }
  { // 4 competitive inhibition
    const p = d.page('Competitive inhibition');
    d.text(p, 'The inhibitor competes for the active site', 40, 100, 16, f.sans, BODY);
    d.text(p, 'Vmax is unchanged', 40, 128, 16, f.sans, BODY);
    d.text(p, 'Km rises by (1 + [I]/Ki)', 40, 156, 16, f.sans, BODY);
    d.text(p, 'v = Vmax [S] / (Km + [S])', 40, 196, 18, f.serif);
    d.text(p, 'Vmax = 10, Km = 2, [I]/Ki = 1', 40, 226, 15, f.sans, BODY);
    // enzyme with S or I in the pocket
    const y = 330;
    const enzyme = (x: number) => d.poly(p, [[x, y - 40], [x + 90, y - 40], [x + 90, y + 40], [x, y + 40], [x, y + 12], [x + 30, y + 12], [x + 30, y - 12], [x, y - 12]], TINT_B, BLUE, 1.4);
    d.rect(p, 40, y - 12, 30, 24, TINT_G, GREEN, 1.4); d.text(p, 'S', 49, y + 6, 15, f.bold, GREEN);
    enzyme(110); d.text(p, 'E', 168, y + 6, 18, f.bold, BLUE);
    d.rect(p, 250, y - 12, 30, 24, TINT_R, RED, 1.4); d.text(p, 'I', 262, y + 6, 15, f.bold, RED);
    d.arrow(p, [80, y + 30], [104, y + 8], 1.2, GREEN, 7);
    d.arrow(p, [244, y + 30], [146, y + 8], 1.2, RED, 7);
    d.text(p, 'S and I bind the same pocket:', 40, y + 80, 13, f.sans, GRAY);
    d.text(p, 'only one at a time', 40, y + 98, 13, f.sans, GRAY);
    const m = d.axes(p, { x: 400, y: 120, w: 320, h: 290, xmax: 20, ymax: 12, xLabel: '[S]', yLabel: 'v', xTicks: [2, 4, 10, 15, 20], yTicks: [5, 10] });
    d.line(p, m(0, Vmax), m(20, Vmax), 1, GRAY, [5, 3]);
    d.plot(p, m, mm(Km), 0, 20, BLUE);
    d.plot(p, m, mm(Km * (1 + ratio)), 0, 20, RED, 2.2, [6, 4]);
    d.guides(p, m, Km, Vmax / 2); d.dot(p, ...m(Km, Vmax / 2), 4);
    d.guides(p, m, Km * (1 + ratio), Vmax / 2); d.dot(p, ...m(Km * (1 + ratio), Vmax / 2), 4, RED);
    d.label(p, 'no inhibitor', m(13, mm(Km)(13)), -10, -10, 13, BLUE);
    d.label(p, 'with inhibitor', m(13, mm(Km * (1 + ratio))(13)), 0, 22, 13, RED);
    d.text(p, 'apparent Km = 2 x (1 + 1) = 4', 400, 490, 14, f.bold, BODY);
  }
  await d.save('public/fixtures/bio.pdf');
}

// Deck 4: three slides from the decks above in one file, for the ?script=canvas demo (drawing on a
// slide's own chart, lifting its figure onto the board, annotating its equations): econ p12 (a tax
// wedge), bio p4 (competitive inhibition), mechanics p2 (velocity as a slope). Built from the
// generated decks, so run after them.
async function canvas(): Promise<void> {
  const out = await PDFDocument.create();
  out.setTitle('Three sample slides: a tax, an inhibitor, a slope (sample deck)');
  out.setAuthor('petu synthetic deck');
  out.setCreator('scripts/make-decks.ts');
  out.setProducer('pdf-lib');
  const t = new Date('2026-10-28T00:00:00Z');
  out.setCreationDate(t);
  out.setModificationDate(t);
  for (const [file, page] of [['econ', 12], ['bio', 4], ['mechanics', 2]] as const) {
    const src = await PDFDocument.load(readFileSync(`public/fixtures/${file}.pdf`));
    const [p] = await out.copyPages(src, [page - 1]);
    out.addPage(p);
  }
  writeFileSync('public/fixtures/canvas.pdf', await out.save({ useObjectStreams: false }));
  console.log('wrote public/fixtures/canvas.pdf (3 pages)');
}

// Deck 5: the prompt's few-shot examples (server/prompt/examples.ts) as real slides, so their scripts
// play on the board (`?script=ex-village`, `ex-forecast`, `ex-counter`) and the gallery shows what a
// student would see. Pages sit at the examples' own page numbers (2: the counter's chart; 3–5: the
// village; 7: the forecast); the music page is not drawn (its sharp sign is outside WinAnsi).
async function examples(): Promise<void> {
  const d = await Deck.create('Prompt examples: a counter, a village, a forecast (sample deck)');
  d.page();
  {
    const p = d.page('Waiting at one counter');
    d.bullets(p, ['One clerk serves 10 people an hour. The average wait is 60 / (10 - a) minutes,', 'where a is the number arriving each hour.'], 100, 15);
    d.axes(p, { x: 440, y: 200, w: 300, h: 280, xmax: 10, ymax: 60, xLabel: 'a', yLabel: 'wait', xTicks: [0, 2, 4, 6, 8, 10], yTicks: [0, 20, 40, 60] });
    d.text(p, 'arrivals per hour', 520, 520, 12, d.f.sans, GRAY);
  }
  {
    const p = d.page("A village's income");
    d.bullets(p, ['The baker pays the smith 30 coins for tools; the smith pays the baker 20 coins for bread.', 'Travellers spend 50 coins at the baker. The smith buys 10 coins of salt from outside.'], 100, 14);
    // two houses and a road: the village
    for (const [x, c] of [[470, TINT_B], [610, TINT_R]] as const) { d.rect(p, x, 300, 90, 70, c, INK); d.poly(p, [[x - 8, 300], [x + 45, 260], [x + 98, 300]], PANEL, INK); }
    d.text(p, 'baker', 492, 395, 13, d.f.sans, BODY);
    d.text(p, 'smith', 634, 395, 13, d.f.sans, BODY);
    d.line(p, [420, 430], [760, 430], 1.2, GRAY, [6, 4]);
  }
  {
    const p = d.page('Drawing the line');
    d.bullets(p, ['Payments between people inside the line cancel; only payments that cross it change the total.'], 100, 14);
  }
  {
    const p = d.page('Every line agrees');
    d.bullets(p, ['Draw the line around any group, and its income is what crosses that line.'], 100, 15);
  }
  d.page();
  {
    const p = d.page('Reading a forecast');
    d.bullets(p, ['A 70% chance of rain means it rains on about 7 of every 10 days', 'that get this same forecast.', 'It is not a promise about today, which will either be wet or dry.'], 110, 16);
  }
  await d.save('public/fixtures/examples.pdf');
}

// `npm run decks` writes every deck; `... make-decks.ts bio` (or econ, mechanics, canvas, examples) writes only those.
const decks: Record<string, () => Promise<void>> = { econ, mechanics, bio, canvas, examples };
const only = process.argv.slice(2);
for (const name of only) if (!decks[name]) throw new Error(`unknown deck ${name} (${Object.keys(decks).join(', ')})`);
for (const [name, make] of Object.entries(decks)) if (!only.length || only.includes(name)) await make();
