// src/desk/kit/compute.ts
/**
 * The visual kit's arithmetic (spec "Visual kit v1"): every number the board shows is computed here,
 * never written by the model. Pure functions, no DOM.
 *
 * Values are matrices (number[][]): a grid is R×C, a vector (bars, a one-row grid) is 1×N.
 * Blank output cells (a window op not yet swept) are NaN.
 */
import { compileVars, freeNames, lex, ExprError, MAX_EXPR_CHARS, type VarFn } from '../expr';

export type Mat = number[][];
export const MAX_DIM = 12;
/** A generated grid (size=RxC fn=…) or one computed from it may be this large; past MAX_DIM it shows as an image. */
export const MAX_IMG = 48;
/** Literal values the model writes (vals=, a table's rows, labels): at most this many rows and columns. */
export const MAX_LIT = 40;
/**
 * The hard memory limit for computed data (size=RxC, a window's output): cells. Past it the block is
 * a skip whose reason names this limit; below it everything is computed in full (images show decimated).
 */
export const MAX_CELLS = 200_000;

/** A seeded uniform generator (mulberry32 over a hash of `seed`): a block's noise is the same on every replay. */
export function seededRand(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "1,2,3;4,5,6" or "1 2 3; 4 5 6" → rows. Null unless every row has the same length (≤ MAX_LIT each way) and every cell is a finite number. */
export function parseVals(s: string | undefined): Mat | null {
  const got = parseCells(s);
  return got && !got.cells ? got.vals : null;
}

/**
 * Like parseVals, but a cell may also be a formula over names bound later ({{const}}: `z*sigma/sqrt(n10)`,
 * `a`): its value is NaN here and its source is kept in `cells` (null for the literal cells), for
 * `resolveCells` when the block builds. Null when malformed.
 */
export function parseCells(s: string | undefined): { vals: Mat; cells?: (string | null)[][] } | null {
  if (!s) return null;
  const raw = s.split(';').map((r) => r.trim()).filter(Boolean).map((r) => r.split(/[\s,]+/).filter(Boolean));
  if (!raw.length || raw.length > MAX_LIT) return null;
  const n = raw[0].length;
  if (!n || n > MAX_LIT || raw.some((r) => r.length !== n)) return null;
  let named = false;
  const cells = raw.map((r) => r.map((v) => {
    if (Number.isFinite(cellValue(v))) return null;
    const names = v.length <= MAX_EXPR_CHARS ? freeNames(v) : null;
    if (!names?.length) return undefined;
    try { compileVars(v, names); } catch { return undefined; }
    named = true;
    return v;
  }));
  if (cells.some((r) => r.some((c) => c === undefined))) return null;
  const vals = raw.map((r) => r.map((v) => cellValue(v)));
  return named ? { vals, cells: cells as (string | null)[][] } : { vals };
}

/** A block's literal values with its formula cells evaluated with the constants; a string names a missing one. */
export function resolveCells(vals: Mat, cells: (string | null)[][] | undefined, consts: Record<string, number>): Mat | string {
  if (!cells) return vals.map((r) => r.slice());
  const out = vals.map((r) => r.slice());
  for (let r = 0; r < out.length; r++) for (let c = 0; c < out[r].length; c++) {
    const src = cells[r]?.[c];
    if (src == null) continue;
    const missing = (freeNames(src) ?? []).find((k) => !(k in consts));
    if (missing) return `vals: no constant ${missing}`;
    const v = compileVars(src, Object.keys(consts))(consts);
    if (!Number.isFinite(v)) return `vals: ${src} is not a number`;
    out[r][c] = v;
  }
  return out;
}

/** One literal cell: a number, or a constant written as arithmetic (1/9, -1/4, 2^3, sqrt(2)). */
function cellValue(v: string): number {
  const n = Number(v.replace(/−/g, '-'));
  if (Number.isFinite(n) || v.length > MAX_EXPR_CHARS) return n;
  try { return compileVars(v, [])({}); } catch { return NaN; }
}

export const flat = (m: Mat) => m.flat();
export const shape = (m: Mat): [number, number] => [m.length, m[0]?.length ?? 0];
export const sameShape = (a: Mat, b: Mat) => a.length === b.length && a[0]?.length === b[0]?.length;

/** Summary statistics of a block's values (blank cells left out). */
export type Stats = { n: number; sum: number; mean: number; min: number; max: number; norm: number; std: number };
export function stats(m: Mat): Stats {
  const xs = flat(m).filter(Number.isFinite);
  const n = xs.length;
  const sum = xs.reduce((s, x) => s + x, 0);
  const mean = n ? sum / n : NaN;
  const norm = Math.sqrt(xs.reduce((s, x) => s + x * x, 0));
  const std = n ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n) : NaN;
  return { n, sum, mean, min: n ? Math.min(...xs) : NaN, max: n ? Math.max(...xs) : NaN, norm, std };
}

// ------------------------------------------------------------------------------------------------
// Number formatting: tabular numerals, a true minus sign, no trailing zeros.

const MINUS = '−';
/**
 * A value as the board writes it. `dp` fixes the decimals; otherwise integers stay whole and others
 * get ~2 significant decimals (133.3, 0.33). Computed values are always decimals; `frac` is only for
 * values the model itself wrote as fractions (kernel weights 1/9), which keep that form.
 */
export function fmt(v: number, dp?: number, frac = false): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? '' : v > 0 ? '∞' : `${MINUS}∞`;
  let s: string;
  if (dp != null) s = v.toFixed(dp);
  else {
    const r = Math.round(v * 1e9) / 1e9;
    const q = frac ? fracDen(v) : null;
    if (Number.isInteger(r)) s = String(r);
    else if (q) s = `${Math.round(v * q)}/${q}`;
    else {
      const a = Math.abs(v);
      s = a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toPrecision(2);
      if (s.includes('.') && !s.includes('e')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
  }
  if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
  return s.replace('-', MINUS);
}
/**
 * Thirds, sixths, ninths, twelfths (1/9, 2/3) for a value that has no short decimal, as a board
 * would write it; null for values a decimal writes exactly (0.5, 0.25) or anything else.
 */
function fracDen(v: number): number | null {
  if (!(Math.abs(v) < 1000)) return null;
  if (Math.abs(v * 100 - Math.round(v * 100)) < 1e-9) return null;
  for (const q of [3, 6, 9, 12]) if (Math.abs(v * q - Math.round(v * q)) < 1e-9) return q;
  return null;
}

/** Whether a set of literal values reads well with fractions: every one is whole, a short decimal or a third/sixth/ninth. One 0.714… and the set stays decimal, so a column never mixes 1/3 with 0.71. */
export const fractions = (xs: number[]) => xs.every((v) => !Number.isFinite(v) || Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 || fracDen(v) != null);

/** A value inside an expansion: negatives in parentheses, so `9·(−1)` reads right. */
export const term = (v: number, dp?: number, frac = false) => (v < 0 && fmt(v, dp, frac) !== '0' ? `(${fmt(v, dp, frac)})` : fmt(v, dp, frac));

// ------------------------------------------------------------------------------------------------
// Element-wise maps and zips over the safe expression parser.

/** Names a map's fn may use: x (the cell), y (the other block's cell, in a zip), and the source's stats. */
export const MAP_VARS = ['x', 'y', 'mean', 'sum', 'min', 'max', 'norm', 'std', 'n', 'i'] as const;

export function compileFn(src: string, names: readonly string[] = MAP_VARS, rand?: () => number): VarFn | null {
  try { return compileVars(src, names, rand ? { rand } : {}); } catch (e) { if (e instanceof ExprError) return null; throw e; }
}

/**
 * The step a fn of the form (A) / B adds to its expansion: "1200 / 9 = " (the numerator and
 * denominator evaluated), so a mean written out reads "(106 + … + 194) / 9 = 1200 / 9 = 133.3". Null otherwise.
 */
export function divisionStep(src: string, env: Record<string, number>, names: readonly string[], dp?: number): string | null {
  const s = src.trim();
  if (s[0] !== '(') return null;
  let depth = 0, close = -1;
  for (let i = 0; i < s.length; i++) { if (s[i] === '(') depth++; else if (s[i] === ')' && --depth === 0) { close = i; break; } }
  if (close < 0) return null;
  const rest = s.slice(close + 1).trim();
  if (!/^[/÷]/.test(rest)) return null;
  // The divisor must be one term (a number, a name, or one parenthesised group): in (A)/B*C the
  // division is not the last step, so there is no "sum / n" to show.
  const d = rest.slice(1).trim();
  if (!/^(\d+(\.\d+)?|[A-Za-z][A-Za-z0-9_]*)$/.test(d)) {
    if (d[0] !== '(') return null;
    let k = 0, end = -1;
    for (let i = 0; i < d.length; i++) { if (d[i] === '(') k++; else if (d[i] === ')' && --k === 0) { end = i; break; } }
    if (end !== d.length - 1) return null;
  }
  const num = compileFn(s.slice(1, close), names), den = compileFn(d, names);
  if (!num || !den) return null;
  const a = num(env), b = den(env);
  return Number.isFinite(a) && Number.isFinite(b) ? `${fmt(a, dp)} / ${fmt(b, dp)} = ` : null;
}

const statEnv = (s: Stats) => ({ mean: s.mean, sum: s.sum, min: s.min, max: s.max, norm: s.norm, std: s.std, n: s.n });

/** fn(x) per cell; the source's stats (mean, std, norm…) are constants in fn. i = 1-based position in reading order. */
export function mapMat(m: Mat, fn: VarFn): Mat {
  const env = statEnv(stats(m));
  let i = 0;
  return m.map((row) => row.map((x) => { i++; return Number.isFinite(x) ? fn({ ...env, x, i }) : NaN; }));
}

/** fn(x, y) per cell of two blocks of the same shape; mean, std… are x's. Null on a shape mismatch. */
export function zipMat(a: Mat, b: Mat, fn: VarFn): Mat | null {
  if (!sameShape(a, b)) return null;
  const env = statEnv(stats(a));
  let i = 0;
  return a.map((row, r) => row.map((x, c) => { i++; const y = b[r][c]; return Number.isFinite(x) && Number.isFinite(y) ? fn({ ...env, x, y, i }) : NaN; }));
}

// ------------------------------------------------------------------------------------------------
// Expansions: the live calculation line ("0·1 + 9·(−1) + … = −27").

/** One line's worth of pieces; the last piece is the result (drawn in the accent). */
export type Expansion = { parts: string[]; result: string; value: number };

/** Terms joined by " + ", the middle elided when there are more than `max`. */
export function joinTerms(ts: string[], sep = ' + ', max = 16): string[] {
  const out = ts.length > max ? [...ts.slice(0, max - 3), '…', ...ts.slice(-2)] : ts;
  return out.map((t, i) => (i < out.length - 1 ? t + sep : t));
}

/** The fn source with values substituted and the operators set as a board would write them. */
export function substitute(src: string, env: Record<string, number>, dp?: number): string {
  let toks;
  try { toks = lex(src); } catch { return src; }
  const out: string[] = [];
  // abs(…) is written |…|: the depth of each open paren, and which of them close an abs.
  const opens: boolean[] = [];
  for (let i = 0; i < toks.length; i++) {
    const k = toks[i];
    if (k.t === 'id' && k.v === 'abs' && toks[i + 1]?.v === '(') { out.push('|'); opens.push(true); i++; continue; }
    if (k.t === 'op' && k.v === '(') { opens.push(false); out.push('('); continue; }
    if (k.t === 'op' && k.v === ')') { out.push(opens.pop() ? '|' : ')'); continue; }
    if (k.t === 'num') out.push(fmt(k.v));
    else if (k.t === 'id') out.push(k.v in env && toks[i + 1]?.v !== '(' ? term(env[k.v], dp) : k.v === 'pi' ? 'π' : k.v === 'sqrt' ? '√' : k.v);
    else if (k.v === ',') out.push(', ');
    else if (k.v === '^') {
      const n = toks[i + 1];
      if (n?.t === 'num' && (n.v === 2 || n.v === 3)) { out.push(n.v === 2 ? '²' : '³'); i++; }
      else out.push('^');
    } else if (k.v === '*') out.push('·');
    else if (k.v === '+' || k.v === '-') {
      const prev = toks[i - 1];
      const binary = prev && (prev.t !== 'op' || prev.v === ')');
      out.push(binary ? (k.v === '+' ? ' + ' : ` ${MINUS} `) : k.v === '-' ? MINUS : '');
    } else if (k.v === '/') out.push(' / ');
    else if (['==', '!=', '<', '>', '<=', '>='].includes(k.v)) out.push(` ${({ '==': '=', '!=': '≠', '<=': '≤', '>=': '≥' } as Record<string, string>)[k.v] ?? k.v} `);
    else out.push(k.v);
  }
  return out.join('');
}

export type Reduce = 'sum' | 'mean' | 'max' | 'min' | 'norm' | 'count' | 'dot' | 'cos' | 'wavg' | 'argmax' | 'quantile';
export const REDUCES: readonly Reduce[] = ['sum', 'mean', 'max', 'min', 'norm', 'count', 'dot', 'cos', 'wavg', 'argmax', 'quantile'];
/** Reductions over one block; dot, cos and wavg (weights, values) take two. */
export const PAIR_REDUCES = new Set<Reduce>(['dot', 'cos', 'wavg']);

/**
 * A reduction with its expansion. `xs` (and `ys` for dot/cos) are the values in reading order;
 * `shown` (optional) are the terms as written (a fn substituted per cell) for sum/mean.
 * quantile (level `q` in [0, 1], default 0.5): the k-th smallest value, k = ceil(q·n) (at least 1) —
 * always a value of the data, as a conformal q̂ or a percentile read off sorted data is.
 */
export function reduce(op: Reduce, xs: number[], ys?: number[], dp?: number, shown?: string[], q = 0.5): Expansion {
  const ok = xs.map((x, i) => Number.isFinite(x) && (!ys || Number.isFinite(ys[i])));
  const X = xs.filter((_, i) => ok[i]), Y = ys?.filter((_, i) => ok[i]);
  const T = shown?.filter((_, i) => ok[i]) ?? X.map((x) => term(x, dp));
  const n = X.length;
  const done = (parts: string[], value: number): Expansion => ({ parts, result: fmt(value, dp), value });
  switch (op) {
    case 'sum': { const v = X.reduce((s, x) => s + x, 0); return done(n > 1 ? [...joinTerms(T), ' = '] : [], v); }
    case 'mean': { const s = X.reduce((a, x) => a + x, 0), v = n ? s / n : NaN; return done(['(', ...joinTerms(T), `) / ${n} = `, ...(n > 1 ? [`${fmt(s, dp)} / ${n} = `] : [])], v); }
    case 'max':
    case 'min': { const v = n ? (op === 'max' ? Math.max(...X) : Math.min(...X)) : NaN; return done([`${op}(`, ...joinTerms(T, ', '), ') = '], v); }
    case 'norm': { const v = Math.sqrt(X.reduce((s, x) => s + x * x, 0)); return done(['√(', ...joinTerms(X.map((x) => `${term(x, dp)}²`)), ') = '], v); }
    case 'count': { const v = X.filter((x) => x !== 0).length; return { parts: [], result: `${v}/${n}`, value: v }; }
    case 'dot': { const v = X.reduce((s, x, i) => s + x * Y![i], 0); return done([...joinTerms(X.map((x, i) => `${term(x, dp)}·${term(Y![i], dp)}`)), ' = '], v); }
    case 'wavg': {
      // Weights first: 0.58·10 + 0.13·20 + … (divided by the weights' sum unless it is 1).
      const sw = X.reduce((a, x) => a + x, 0), d = X.reduce((s, x, i) => s + x * Y![i], 0);
      const one = Math.abs(sw - 1) < 1e-9;
      const terms = joinTerms(X.map((x, i) => `${term(x, dp)}·${term(Y![i], dp)}`));
      return done(one ? [...terms, ' = '] : ['(', ...terms, `) / ${fmt(sw, dp)} = `], sw ? d / sw : NaN);
    }
    case 'argmax': {
      let best = -1;
      X.forEach((x, i) => { if (best < 0 || x > X[best]) best = i; });
      return { parts: ['argmax(', ...joinTerms(T, ', '), ') = '], result: best < 0 ? '' : String(xs.indexOf(X[best]) + 1), value: best < 0 ? NaN : xs.indexOf(X[best]) + 1 };
    }
    case 'quantile': {
      if (!n) return done([], NaN);
      const s = [...X].sort((a, b) => a - b);
      const k = Math.min(n, Math.max(1, Math.ceil(Math.min(1, Math.max(0, q)) * n - 1e-9)));
      return done([`sorted: `, ...joinTerms(s.map((x) => term(x, dp)), ' ≤ ', 12), `; #${k} of ${n} (⌈${fmt(q)}·${n}⌉) = `], s[k - 1]);
    }
    case 'cos': {
      const d = X.reduce((s, x, i) => s + x * Y![i], 0);
      const na = Math.sqrt(X.reduce((s, x) => s + x * x, 0)), nb = Math.sqrt(Y!.reduce((s, y) => s + y * y, 0));
      return done([`${fmt(d)} / (${fmt(na)} · ${fmt(nb)}) = `], na && nb ? d / (na * nb) : NaN);
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Sliding windows: weights (sum of products), a reduction, or a fn of the window's cells.

export type WinOp = 'sum' | 'mean' | 'max' | 'min' | 'median';
export type Window =
  | { kind: 'weights'; w: Mat; flip?: boolean; /** the weights were written as fractions (1/9): keep that form */ frac?: boolean }
  | { kind: 'reduce'; kr: number; kc: number; op: WinOp }
  | { kind: 'fn'; kr: number; kc: number; src: string; fn: VarFn };
export type WinSpec = Window & { same?: boolean; stride?: number };

/** Letters for a window's cells in reading order (a b c / d e f …) in a fn window. */
export const WIN_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

export const winSize = (s: WinSpec): [number, number] => (s.kind === 'weights' ? shape(s.w) : [s.kr, s.kc]);

/** Output shape and padding: valid (the window stays inside) or same (zero padding, one output per input cell, at stride 1). */
export function winGeometry(R: number, C: number, s: WinSpec): { R: number; C: number; pr: number; pc: number; stride: number } | null {
  const [kr, kc] = winSize(s);
  const st = Math.max(1, Math.floor(s.stride ?? 1));
  if (kr < 1 || kc < 1) return null;
  if (s.same) return { R: Math.ceil(R / st), C: Math.ceil(C / st), pr: Math.floor((kr - 1) / 2), pc: Math.floor((kc - 1) / 2), stride: st };
  if (kr > R || kc > C) return null;
  return { R: Math.floor((R - kr) / st) + 1, C: Math.floor((C - kc) / st) + 1, pr: 0, pc: 0, stride: st };
}

/** The input cell (row, col; may be outside the grid in `same`) under output cell (r, c)'s window top-left. */
export function winOrigin(r: number, c: number, g: { pr: number; pc: number; stride: number }): [number, number] {
  return [r * g.stride - g.pr, c * g.stride - g.pc];
}

/** The window's values at output (r, c): zero outside the input (padding). Row-major. */
export function winValues(input: Mat, r: number, c: number, s: WinSpec): { v: number[]; inside: boolean[] } | null {
  const g = winGeometry(input.length, input[0].length, s);
  if (!g) return null;
  const [kr, kc] = winSize(s);
  const [r0, c0] = winOrigin(r, c, g);
  const v: number[] = [], inside: boolean[] = [];
  for (let i = 0; i < kr; i++) for (let j = 0; j < kc; j++) {
    const rr = r0 + i, cc = c0 + j;
    const inGrid = rr >= 0 && cc >= 0 && rr < input.length && cc < input[0].length;
    inside.push(inGrid);
    v.push(inGrid ? input[rr][cc] : 0);
  }
  return { v, inside };
}

/** The weight that multiplies window cell k (row-major): flipped both ways for a flipped kernel. */
function weightAt(s: Extract<Window, { kind: 'weights' }>, k: number): number {
  const [kr, kc] = shape(s.w);
  const i = Math.floor(k / kc), j = k % kc;
  return s.flip ? s.w[kr - 1 - i][kc - 1 - j] : s.w[i][j];
}

/** Output (r, c) with its expansion. */
export function winCell(input: Mat, r: number, c: number, s: WinSpec, dp?: number): Expansion | null {
  const wv = winValues(input, r, c, s);
  if (!wv) return null;
  const { v } = wv;
  if (s.kind === 'weights') {
    const terms = v.map((x, k) => `${term(weightAt(s, k), undefined, s.frac)}·${term(x)}`);
    const value = v.reduce((acc, x, k) => acc + weightAt(s, k) * x, 0);
    return { parts: [...joinTerms(terms), ' = '], result: fmt(value, dp), value };
  }
  if (s.kind === 'reduce') return s.op === 'median' ? median(v, dp) : reduce(s.op, v, undefined, dp);
  const env: Record<string, number> = {};
  v.forEach((x, k) => { if (k < WIN_LETTERS.length) env[WIN_LETTERS[k]] = x; });
  const value = s.fn(env);
  const div = divisionStep(s.src, env, WIN_LETTERS.slice(0, v.length), dp);
  return { parts: [substitute(s.src, env), ' = ', ...(div ? [div] : [])], result: fmt(value, dp), value };
}

/**
 * The median with its working: the window's values sorted, the middle one (the mean of the two middle
 * ones for an even count). "median(10, 100, 10): 10 10 100 → 10" — the sort is what shows a spike dropped.
 */
export function median(xs: number[], dp?: number): Expansion {
  const X = xs.filter(Number.isFinite), n = X.length;
  const s = [...X].sort((a, b) => a - b);
  const value = !n ? NaN : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  return { parts: ['median(', ...joinTerms(X.map((x) => term(x, dp)), ', '), '): ', s.map((x) => term(x, dp)).join(' '), ' → '], result: fmt(value, dp), value };
}

/** The whole output of a window op (NaN where the fn is undefined). */
export function winApply(input: Mat, s: WinSpec): Mat | null {
  const g = winGeometry(input.length, input[0]?.length ?? 0, s);
  if (!g) return null;
  return Array.from({ length: g.R }, (_, r) => Array.from({ length: g.C }, (_, c) => winCell(input, r, c, s)?.value ?? NaN));
}

// ------------------------------------------------------------------------------------------------
// Lines through data: least squares, a line through two points, distance, a band's inliers.

export type Pt = { x: number; y: number };
/** a·x + b·y + c = 0 with (a, b) a unit normal: |a·x + b·y + c| is the distance to the line. */
export type Line = { a: number; b: number; c: number };

function normLine(a: number, b: number, c: number): Line | null {
  const n = Math.hypot(a, b);
  return n > 1e-12 ? { a: a / n, b: b / n, c: c / n } : null;
}

/** The line through two points; null when they coincide. */
export function lineThrough(p: Pt, q: Pt): Line | null {
  return normLine(q.y - p.y, p.x - q.x, q.x * p.y - p.x * q.y);
}

/** Ordinary least squares y = m·x + k (vertical when every x is the same); null under two distinct points. */
export function lstsq(pts: Pt[]): Line | null {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0), sxy = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  if (sxx < 1e-12) return pts.some((p) => Math.abs(p.y - my) > 1e-12) ? normLine(1, 0, -mx) : null;
  const m = sxy / sxx;
  return normLine(m, -1, my - m * mx);
}

/** Slope and intercept of a non-vertical line (y = m·x + k). */
export function slopeOf(l: Line): { m: number; k: number } | null {
  return Math.abs(l.b) < 1e-12 ? null : { m: -l.a / l.b, k: -l.c / l.b };
}

export const distTo = (p: Pt, l: Line) => Math.abs(l.a * p.x + l.b * p.y + l.c);
/** The foot of the perpendicular from p to l. */
export function footOn(p: Pt, l: Line): Pt {
  const d = l.a * p.x + l.b * p.y + l.c;
  return { x: p.x - d * l.a, y: p.y - d * l.b };
}
/** Indices of the points within `w` of the line (the band). */
export const inliers = (pts: Pt[], l: Line, w: number) => pts.flatMap((p, i) => (distTo(p, l) <= w + 1e-12 ? [i] : []));

/** "y = 0.81x + 1.2" (or "x = 3" for a vertical line). */
export function lineLabel(l: Line): string {
  const s = slopeOf(l);
  if (!s) return `x = ${fmt(-l.c / l.a)}`;
  const m = Math.abs(s.m - 1) < 1e-9 ? '' : Math.abs(s.m + 1) < 1e-9 ? MINUS : fmt(s.m);
  const k = Math.abs(s.k) < 1e-9 ? '' : s.k < 0 ? ` ${MINUS} ${fmt(-s.k)}` : ` + ${fmt(s.k)}`;
  if (Math.abs(s.m) < 1e-12) return `y = ${fmt(s.k)}`;
  return `y = ${m}x${k}`;
}

/** Nice tick values covering [lo, hi] (about `n` of them). */
export function ticks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step + 0);
  return out;
}

/** Positions of a sweep: every output cell not yet filled, in reading order. */
export function sweepOrder(filled: boolean[][]): [number, number][] {
  const out: [number, number][] = [];
  filled.forEach((row, r) => row.forEach((f, c) => { if (!f) out.push([r, c]); }));
  return out;
}

/** A sweep's per-position time (ms): `dur` seconds over n positions, or ~0.45s each within 1.5–8s. */
export function sweepStepMs(n: number, durS?: number): number {
  if (n <= 0) return 0;
  const total = durS != null ? Math.max(0, durS) * 1000 : Math.min(8000, Math.max(1500, n * 450));
  return total / n;
}

/**
 * Constants written as formulas (`omega=L/(I0+2*m*r^2)`) follow the constants they read: after `key`
 * changed, every formula constant that reads it (directly or through another one) is evaluated again,
 * in definition order. `derived` holds them (lowercase name, source). A formula that no longer
 * evaluates keeps its last value.
 */
export function rederive(consts: Record<string, number>, derived: readonly [string, string][], key: string): void {
  const changed = new Set([key]);
  for (const [k, src] of derived) {
    if (k === key) continue;
    const names = freeNames(src);
    if (!names?.some((n) => changed.has(n))) continue;
    const f = compileFn(src, Object.keys(consts));
    const v = f ? f(consts) : NaN;
    if (Number.isFinite(v)) { consts[k] = v; changed.add(k); }
  }
}
/** A constant written as a plain number (not a formula over others). */
export const isPlainNumber = (src: string) => /^[-−+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(src.trim());
