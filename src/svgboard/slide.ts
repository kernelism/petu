// src/svgboard/slide.ts — a sliding window the engine draws (teaching-engine proposal §3: engine-owned
// views). The model names the data and the step; the engine lays out the grids, moves the frame, fills the
// outputs and writes the working, all from one computation (src/desk/kit/compute.ts, the kit's windows).
/**
 *   <g id="conv" data-slide="img.f" data-kernel="img.k" data-step="k" data-origin="20,60" data-cell="36"/>   (flags as data-flip="", data-same="")
 *
 *  data-slide    the input: a calc's array or matrix ("img.f"), or literal rows ("1,2,3;4,5,6")
 *  data-kernel   weights (same forms): each output is the sum of products; data-flip turns them first
 *                (convolution); or data-op="mean|median|max|min" with data-size="3x3"
 *  data-step     the step constant (default k): at k = j the frame is on output j and outputs 1…j are
 *                filled; k between steps glides the frame; 0 shows the grids empty
 *  data-same     zero padding (one output per input cell); default valid
 *  data-origin   the input's top-left (board units); data-cell the cell size (default 36)
 *  data-fmt      decimals for the outputs and the working
 *
 * The outputs are the answer's numbers too: the view registers them as a calc named by the element's id
 * ({{val conv.out[4]}}, 0-based, reading order; conv.out[r][c] on a grid), so the voice says what the
 * board shows. Everything drawn is data-engine (the engine's own, not the model's typing).
 */
import * as C from '../desk/kit/compute';
import { pickNumber, type CalcNums, type CalcTable } from '../calc/stream';

const SVGNS = 'http://www.w3.org/2000/svg';
const INK = '#1D1D1F', MUTED = '#6E6E73', CELL = '#FFFFFF', ACCENT = '#7c3aed';
const r2 = (v: number) => String(Math.round(v * 100) / 100);

export type SlideScope = { calcs?: Map<string, CalcTable>; values?: { v: number; of: string; text: string }[] };
export class SlideError extends Error {}

/** A matrix from a calc path ("img.f") or literal rows; `signal`: the data was written as one row ([1, 2, 3]). */
function matrix(src: string, sc: SlideScope, what: string): C.Mat & { signal?: boolean } {
  const s = src.trim();
  const m = /^([A-Za-z]\w*)\.([A-Za-z_][\w.]*)$/.exec(s);
  if (m) {
    const t = sc.calcs?.get(m[1].toLowerCase());
    if (!t) throw new SlideError(`${what}: no calc ${m[1]}`);
    const key = Object.keys(t).find((k) => k.toLowerCase() === m[2].toLowerCase());
    const v: CalcNums | undefined = key ? t[key] : undefined;
    if (v == null || typeof v === 'number') throw new SlideError(`${what}: calc ${m[1]} exports no array ${m[2]}`);
    const rows = Array.isArray(v[0]) ? (v as number[][]) : [v as number[]];
    if (!rows.length || rows.some((r) => r.length !== rows[0].length || r.some((x) => !Number.isFinite(x)))) throw new SlideError(`${what}: ${s} is not a full grid of numbers`);
    return Object.assign(rows.map((r) => r.slice()), Array.isArray(v[0]) ? {} : { signal: true });
  }
  const lit = C.parseVals(s);
  if (!lit) throw new SlideError(`${what}: "${s}" is neither a calc array nor rows of numbers`);
  return lit;
}

/** Draws (or redraws) the view into `el` for step `k`. Returns the outputs (row-major). */
export function drawSlide(el: Element, sc: SlideScope, k: number): C.Mat {
  const input = matrix(el.getAttribute('data-slide')!, sc, 'data-slide');
  const same = el.hasAttribute('data-same');
  let spec: C.WinSpec;
  let kernel: C.Mat | null = null;
  if (el.hasAttribute('data-kernel')) {
    kernel = matrix(el.getAttribute('data-kernel')!, sc, 'data-kernel');
    // Weights that are simple fractions (a box's 1/9) are written as fractions, in the grid and the working.
    const frac = kernel.flat().some((v) => !Number.isInteger(v)) && kernel.flat().every((v) => Number.isInteger(v) || C.fmt(v, undefined, true).includes('/'));
    spec = { kind: 'weights', w: kernel, ...(frac ? { frac: true } : {}), ...(el.hasAttribute('data-flip') ? { flip: true } : {}), ...(same ? { same: true } : {}) };
  } else {
    const op = (el.getAttribute('data-op') ?? '').toLowerCase();
    if (!['mean', 'median', 'max', 'min', 'sum'].includes(op)) throw new SlideError('data-slide needs data-kernel, or data-op="mean|median|max|min" with data-size');
    const sz = /^(\d+)\s*x\s*(\d+)$/i.exec(el.getAttribute('data-size') ?? '');
    if (!sz) throw new SlideError('data-op needs data-size="RxC" (the window, e.g. 3x3)');
    spec = { kind: 'reduce', kr: Number(sz[1]), kc: Number(sz[2]), op: op as C.WinOp, ...(same ? { same: true } : {}) };
  }
  const [R, Cn] = [input.length, input[0].length];
  const g = C.winGeometry(R, Cn, spec);
  if (!g) throw new SlideError(`the window is larger than the input (${R}x${Cn})`);
  const [kr, kc] = C.winSize(spec);
  const fmtA = el.getAttribute('data-fmt');
  const dp = fmtA != null && /^\d+$/.test(fmtA) ? Number(fmtA) : undefined;
  const cells = Array.from({ length: g.R }, (_, r) => Array.from({ length: g.C }, (_, c) => C.winCell(input, r, c, spec, dp)));
  const outs = cells.map((row) => row.map((e) => e?.value ?? NaN));
  const n = g.R * g.C;

  // The outputs are the answer's numbers: a calc named by the element's id.
  const id = (el.getAttribute('data-name') ?? el.getAttribute('id') ?? '').toLowerCase();
  // Shaped as the input is: a signal (one row) gives a row (out[i]); an image gives rows (out[r][c]), even
  // when its window fits only one row down (a 3x4 image under a 3x3 window: out[0][0], out[0][1]; live D2.2).
  // As the data was written: [[2, 3, 20]] gives out[0][j] (live D2.3), [2, 3, 20] gives out[j]; literal rows of one row, a row.
  if (id && sc.calcs) sc.calcs.set(id, { out: R === 1 && (input.signal ?? !/^[A-Za-z]/.test(el.getAttribute('data-slide')!.trim())) ? outs[0] : outs, n });
  // And computed values on the board, for the gate's number checks (as a data-val's are).
  for (const v of outs.flat()) if (Number.isFinite(v)) sc.values?.push({ v, of: id || 'slide', text: C.fmt(v, dp) });

  // Layout: input, kernel (if any) to its right, output right of that when it fits, else under the input.
  const cs = Number(el.getAttribute('data-cell') ?? '36') || 36;
  const [ox, oy] = (el.getAttribute('data-origin') ?? '20,60').split(',').map(Number);
  const gap = cs * 0.9, W = 560;
  const inW = Cn * cs, inH = R * cs;
  const kx = ox + inW + gap, kW = kernel ? kernel[0].length * cs : 0, kH = kernel ? kernel.length * cs : 0;
  // Convolution shows the kernel as given, then turned around (the one the working uses), an arrow between.
  const flip = !!kernel && el.hasAttribute('data-flip');
  const tx = flip ? kx + kW + gap * 1.2 : kx;
  const right = (kernel ? tx + kW + gap : ox + inW + gap);
  const outW = g.C * cs, outH = g.R * cs;
  const outBeside = right + outW <= W - 8;
  const outX = outBeside ? right : ox, outY = outBeside ? oy : oy + Math.max(inH, kH) + cs * 0.9;
  const lineY = Math.max(oy + inH, oy + kH, outY + outH) + cs * 0.95;

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
  const fs = r2(Math.max(14, cs * 0.42)), cap = r2(Math.max(14, cs * 0.38));
  const grid = (x0: number, y0: number, m: C.Mat, show: (r: number, c: number) => boolean, color = INK, frac = false) => {
    m.forEach((row, r) => row.forEach((v, c) => {
      add('rect', { x: r2(x0 + c * cs), y: r2(y0 + r * cs), width: r2(cs), height: r2(cs), fill: CELL, stroke: MUTED, 'stroke-width': '1' });
      if (show(r, c) && Number.isFinite(v)) add('text', { x: r2(x0 + c * cs + cs / 2), y: r2(y0 + r * cs + cs / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': frac ? r2(Math.min(Number(fs), cs * 0.34)) : fs, fill: color }, C.fmt(v, dp, frac));
    }));
  };
  // The step: k = j has the frame on output j (1-based), outputs 1…j filled; between steps the frame glides.
  const kk = Math.max(0, Math.min(n, k));
  const done = Math.floor(kk + 1e-6);
  grid(ox, oy, input, () => true);
  add('text', { x: r2(ox), y: r2(oy - cs * 0.3), 'font-size': cap, fill: MUTED }, 'input');
  if (kernel) {
    // Convolution's kernel is shown as it is used: turned around (the working multiplies by these).
    const fr = spec.kind === 'weights' && !!spec.frac;
    grid(kx, oy, kernel, () => true, INK, fr);
    add('text', { x: r2(kx), y: r2(oy - cs * 0.3), 'font-size': cap, fill: MUTED }, 'kernel');
    if (flip) {
      const turned = kernel.slice().reverse().map((row) => row.slice().reverse());
      const ay = oy + kH / 2;
      add('path', { d: `M${r2(kx + kW + gap * 0.2)} ${r2(ay)}H${r2(tx - gap * 0.25)}M${r2(tx - gap * 0.45)} ${r2(ay - 5)}L${r2(tx - gap * 0.25)} ${r2(ay)}L${r2(tx - gap * 0.45)} ${r2(ay + 5)}`, fill: 'none', stroke: MUTED, 'stroke-width': '1.5' });
      grid(tx, oy, turned, () => true, INK, fr);
      add('text', { x: r2(tx), y: r2(oy - cs * 0.3), 'font-size': cap, fill: MUTED }, 'turned');
    }
  }
  grid(outX, outY, outs, (r, c) => r * g.C + c < done, ACCENT);
  add('text', { x: r2(outX), y: r2(outY - cs * 0.3), 'font-size': cap, fill: MUTED }, 'output');
  if (kk > 0) {
    // The frame's place in output order (0-based, fractional while it glides): between outputs a and a + 1.
    const pos = Math.min(n - 1, kk - 1), a0 = Math.max(0, Math.floor(pos)), t = Math.max(0, pos - a0), a1 = Math.min(n - 1, a0 + 1);
    const at = (j: number) => { const [r0, c0] = C.winOrigin(Math.floor(j / g.C), j % g.C, g); return { x: ox + c0 * cs, y: oy + r0 * cs }; };
    const p0 = at(a0), p1 = at(a1);
    const fx = p0.x + (p1.x - p0.x) * t, fy = p0.y + (p1.y - p0.y) * t;
    add('rect', { x: r2(fx - 2), y: r2(fy - 2), width: r2(kc * cs + 4), height: r2(kr * cs + 4), rx: '4', fill: ACCENT, 'fill-opacity': '0.07', stroke: ACCENT, 'stroke-width': '2.5', 'data-slide-frame': '' });
    const a = t < 0.5 ? a0 : a1;
    const o = { x: outX + (a % g.C) * cs, y: outY + Math.floor(a / g.C) * cs };
    add('rect', { x: r2(o.x - 2), y: r2(o.y - 2), width: r2(cs + 4), height: r2(cs + 4), rx: '4', fill: 'none', stroke: ACCENT, 'stroke-width': '2.5' });
    const e = cells[Math.floor(a / g.C)][a % g.C];
    if (e) {
      // As many whole terms as fit the board's width (about 0.6 em a character, as the board measures), then the result.
      const max = Math.max(24, Math.floor((W - ox - 6) / (Number(cap) * 0.62)));
      const terms = e.parts.join('').replace(/\s*=\s*$/, '').split(/(?= \+ )/);
      const tail = ` = ${e.result}`;
      let line = '';
      for (const t of terms) { if ((line + t).length + tail.length + 4 > max) { line += ' + …'; break; } line += t; }
      line += tail;
      add('text', { x: r2(ox), y: r2(lineY), 'font-size': cap, fill: INK, 'data-slide-line': '' }, line);
    }
  }
  return outs;
}

/** The value a {{val}} of a slide's outputs says (for tests): `pickNumber` on what the view registered. */
export const slideOut = (sc: SlideScope, id: string, path: string): number | undefined => {
  const t = sc.calcs?.get(id.toLowerCase());
  return t ? pickNumber(t, path) : undefined;
};
