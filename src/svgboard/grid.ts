// src/svgboard/grid.ts — a grid filled by rule, cell by cell (teaching-engine proposal §4 and Phase 3: the
// grid-fill pattern: Punnett squares, outer products, the Gaussian table from its formula). The engine
// lays out the headers and the cells, fills them in reading order on a step constant, frames the cell it
// is on with its row and column, and writes that cell's working. The model names the data and the step.
/**
 *   <g id="sep" data-grid="mul" data-rows="1/3,1/3,1/3" data-cols="1/3,1/3,1/3" data-const="k=0" data-step="k"/>
 *
 *  data-grid     the cells: a calc's matrix ("g.G") or literal rows ("1,2;3,4"), or a rule over the headers:
 *                "mul" (row × column: an outer product), "add" (row + column), "join" (the two labels
 *                together, a Punnett square: "A" and "a" make "Aa")
 *  data-rows     the row headers (a calc array, or a literal list "A,a" / "-1,0,1"); data-cols the columns
 *  data-rows-name / data-cols-name   what the headers are ("y", "x"): the working names them
 *  data-step     the step constant (default k): at k = j cells 1…j are filled and the frame is on cell j;
 *                0 shows the empty grid with its headers
 *  data-origin   the top-left (board units); data-cell the cell size (default 44, shrunk to fit the board)
 *  data-fmt      decimals for the cells and the working
 *
 * Its numbers register as a calc named by the element's id ({{val sep.out[0][2]}}, 0-based), and every
 * drawn part is data-engine.
 */
import * as C from '../desk/kit/compute';
import { matrix, SlideError, type SlideScope } from './slide';

const SVGNS = 'http://www.w3.org/2000/svg';
const INK = '#1D1D1F', MUTED = '#6E6E73', CELL = '#FFFFFF', HEAD = '#F5F5F7', ACCENT = '#7c3aed';
const r2 = (v: number) => String(Math.round(v * 100) / 100);
const W = 560;

type Rule = 'mul' | 'add' | 'join';
const RULES: Record<string, Rule> = { mul: 'mul', times: 'mul', '×': 'mul', '*': 'mul', outer: 'mul', add: 'add', plus: 'add', '+': 'add', join: 'join', punnett: 'join' };

/** Header labels: a calc array (numbers) or a literal list (numbers or words). */
function headers(src: string | null, sc: SlideScope, what: string): { labels: string[]; nums: number[] | null } | null {
  if (src == null || !src.trim()) return null;
  const s = src.trim();
  if (/^[A-Za-z]\w*\.[A-Za-z_][\w.]*$/.test(s)) {
    const m = matrix(s, sc, what);
    const xs = m.length === 1 ? m[0] : m.every((r) => r.length === 1) ? m.map((r) => r[0]) : null;
    if (!xs) throw new SlideError(`${what}: ${s} is a grid, not a list`);
    return { labels: xs.map((v) => C.fmt(v)), nums: xs };
  }
  const parts = s.split(/\s*[,;]\s*|\s+/).filter(Boolean);
  const nums = parts.map((p) => {
    const f = /^([-−]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(p);
    return f ? Number(f[1].replace('−', '-')) / Number(f[2]) : Number(p.replace('−', '-'));
  });
  // Numbers are written as the engine writes them (its minus sign); a fraction keeps its slash.
  if (!nums.every(Number.isFinite)) return { labels: parts, nums: null };
  return { labels: parts.map((p, i) => (p.includes('/') ? p.replace(/^-/, '−') : C.fmt(nums[i]))), nums };
}

/** Two alleles together as genetics writes them: per gene, the capital first ("a" + "A" → "Aa"). */
export function joinLabels(a: string, b: string): string {
  if (a.length !== b.length) return a + b;
  let out = '';
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i], b[i]];
    out += x.toLowerCase() === y.toLowerCase() && x === x.toLowerCase() && y !== y.toLowerCase() ? y + x : x + y;
  }
  return out;
}

export type GridDraw = { outs: C.Mat | null; texts: string[][] };

/** Draws (or redraws) the grid into `el` for step `k`. */
export function drawGrid(el: Element, sc: SlideScope, k: number): GridDraw {
  const src = (el.getAttribute('data-grid') ?? '').trim();
  const rule = RULES[src.toLowerCase()];
  const rows = headers(el.getAttribute('data-rows'), sc, 'data-rows');
  const cols = headers(el.getAttribute('data-cols'), sc, 'data-cols');
  const fmtA = el.getAttribute('data-fmt');
  const dp = fmtA != null && /^\d+$/.test(fmtA) ? Number(fmtA) : undefined;
  let outs: C.Mat | null = null;
  let texts: string[][];
  if (rule) {
    if (!rows || !cols) throw new SlideError(`data-grid="${src}" fills from its headers: give data-rows and data-cols`);
    if (rule === 'join') texts = rows.labels.map((a) => cols.labels.map((b) => joinLabels(a, b)));
    else {
      if (!rows.nums || !cols.nums) throw new SlideError(`data-grid="${src}" needs numbers in data-rows and data-cols`);
      outs = rows.nums.map((a) => cols.nums!.map((b) => (rule === 'mul' ? a * b : a + b)));
    }
  } else {
    if (!src) throw new SlideError('data-grid needs the cells (a calc matrix or rows) or a rule: mul, add or join');
    outs = matrix(src, sc, 'data-grid');
  }
  const R = outs ? outs.length : rows!.labels.length, Cn = outs ? outs[0].length : cols!.labels.length;
  if (rows && rows.labels.length !== R) throw new SlideError(`data-rows has ${rows.labels.length} labels for ${R} rows`);
  if (cols && cols.labels.length !== Cn) throw new SlideError(`data-cols has ${cols.labels.length} labels for ${Cn} columns`);
  if (R * Cn > 144) throw new SlideError(`a ${R}x${Cn} grid is too big to fill cell by cell (at most 144 cells)`);
  // Fractions in, fractions out (1/3 × 1/3 is written 1/9), as the window writes a box's weights.
  const frac = !!outs && dp == null && outs.flat().some((v) => !Number.isInteger(v)) && [...outs.flat(), ...(rows?.nums ?? []), ...(cols?.nums ?? [])].every((v) => Number.isInteger(v) || C.fmt(v, undefined, true).includes('/'))
    && [rows?.labels ?? [], cols?.labels ?? []].flat().some((l) => l.includes('/'));
  texts ??= outs!.map((r) => r.map((v) => C.fmt(v, dp, frac)));

  const id = (el.getAttribute('data-name') ?? el.getAttribute('id') ?? '').toLowerCase();
  if (outs) {
    if (id && sc.calcs) sc.calcs.set(id, { out: outs, n: R * Cn });
    for (const v of outs.flat()) if (Number.isFinite(v)) sc.values?.push({ v, of: id || 'grid', text: C.fmt(v, dp, frac) });
  }

  // Layout: column headers on top, row headers on the left, the cells, the working under them.
  const [ox, oy] = (el.getAttribute('data-origin') ?? '20,60').split(',').map(Number);
  const longest = Math.max(1, ...texts.flat().map((t) => t.length));
  const headLen = Math.max(1, ...(rows?.labels ?? []).map((l) => l.length));
  const want = Number(el.getAttribute('data-cell')) || Math.max(44, Math.min(64, longest * 9 + 14));
  const hw0 = rows ? Math.max(44, headLen * 11 + 18) : 0;
  const cs = Math.max(18, Math.min(want, (W - 8 - ox - hw0) / Cn));
  const hw = rows ? Math.min(hw0, Math.max(44, cs)) : 0, hh = cols ? Math.max(24, cs * 0.7) : 0;
  const gx = ox + hw, gy = oy + hh;
  const fs = (t: string, w = cs) => r2(Math.max(10, Math.min(cs * 0.4, (w - 8) / (0.6 * Math.max(1, t.length)))));

  for (const old of Array.from(el.querySelectorAll(':scope > [data-engine]'))) old.remove();
  const doc = el.ownerDocument;
  const add = (name: string, attrs: Record<string, string>, text?: string) => {
    const e = doc.createElementNS(SVGNS, name);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
    e.setAttribute('data-engine', '');
    if (text != null) e.textContent = text;
    el.appendChild(e);
    return e;
  };
  const n = R * Cn;
  const kk = Math.max(0, Math.min(n, k));
  const done = Math.floor(kk + 1e-6);
  const at = done - 1, ar = at >= 0 ? Math.floor(at / Cn) : -1, ac = at >= 0 ? at % Cn : -1;
  const text = (x: number, y: number, t: string, color: string, size: string = fs(t)) => add('text', { x: r2(x), y: r2(y), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': size, fill: color }, t);

  const rn = el.getAttribute('data-rows-name')?.trim(), cn = el.getAttribute('data-cols-name')?.trim();
  if (rows && cols) {
    const corner = rule === 'mul' ? '×' : rule === 'add' ? '+' : rn && cn ? `${rn} \\ ${cn}` : '';
    if (corner) text(ox + hw / 2, oy + hh / 2, corner, MUTED, r2(Math.min(15, cs * 0.36, (hw - 6) / (0.6 * corner.length))));
  }
  if (cols) cols.labels.forEach((l, c) => {
    const on = c === ac;
    add('rect', { x: r2(gx + c * cs), y: r2(oy), width: r2(cs), height: r2(hh), fill: on ? ACCENT : HEAD, 'fill-opacity': on ? '0.14' : '1', stroke: MUTED, 'stroke-width': '1' });
    text(gx + c * cs + cs / 2, oy + hh / 2, l, on ? ACCENT : INK);
  });
  if (rows) rows.labels.forEach((l, r) => {
    const on = r === ar;
    add('rect', { x: r2(ox), y: r2(gy + r * cs), width: r2(hw), height: r2(cs), fill: on ? ACCENT : HEAD, 'fill-opacity': on ? '0.14' : '1', stroke: MUTED, 'stroke-width': '1' });
    text(ox + hw / 2, gy + r * cs + cs / 2, l, on ? ACCENT : INK, fs(l, hw));
  });
  if (cn && cols && !rows) add('text', { x: r2(gx), y: r2(oy - 8), 'font-size': '14', fill: MUTED }, cn);
  for (let r = 0; r < R; r++) for (let c = 0; c < Cn; c++) {
    add('rect', { x: r2(gx + c * cs), y: r2(gy + r * cs), width: r2(cs), height: r2(cs), fill: CELL, stroke: MUTED, 'stroke-width': '1' });
    if (r * Cn + c < done && texts[r][c]) text(gx + c * cs + cs / 2, gy + r * cs + cs / 2, texts[r][c], r * Cn + c === at ? ACCENT : INK);
  }
  if (at >= 0) {
    add('rect', { x: r2(gx + ac * cs - 2), y: r2(gy + ar * cs - 2), width: r2(cs + 4), height: r2(cs + 4), rx: '4', fill: 'none', stroke: ACCENT, 'stroke-width': '2.5', 'data-grid-frame': '' });
    const line = working(rule, rows, cols, rn, cn, ar, ac, texts[ar][ac]);
    if (line) add('text', { x: r2(ox), y: r2(gy + R * cs + 28), 'font-size': '14', fill: INK, 'data-grid-line': '' }, line);
  }
  return { outs, texts };
}

/** The current cell's working: "1/3 × 1/3 = 1/9", "A + a → Aa", "y = −1, x = 0: 0.097". */
function working(rule: Rule | undefined, rows: ReturnType<typeof headers>, cols: ReturnType<typeof headers>, rn: string | undefined, cn: string | undefined, r: number, c: number, cell: string): string {
  const a = rows?.labels[r], b = cols?.labels[c];
  const t = (l: string | undefined, v: number | undefined) => (v != null && v < 0 ? `(${l})` : l);
  if (rule === 'mul') return `${t(a, rows!.nums![r])} × ${t(b, cols!.nums![c])} = ${cell}`;
  if (rule === 'add') return `${t(a, rows!.nums![r])} + ${t(b, cols!.nums![c])} = ${cell}`;
  if (rule === 'join') return `${a} + ${b} → ${cell}`;
  const where = [a != null ? (rn ? `${rn} = ${a}` : `row ${a}`) : `row ${r + 1}`, b != null ? (cn ? `${cn} = ${b}` : `column ${b}`) : `column ${c + 1}`];
  return `${where.join(', ')}: ${cell}`;
}
