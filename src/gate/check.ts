// src/gate/check.ts — the commit gate's deterministic beat checker. Pure functions over a parsed
// beat and the engine state after it (src/gate/engine.ts), plus layout boxes (src/gate/layout.ts).
//   (a) numbers: every number the narration states matches the page, the question, a tag literal,
//       a constant, an engine-computed value, or one arithmetic step from those; threshold claims
//       ("eleven bring it below one percent") and direction claims about a computed column
//       ("Harris gives the second patch a lower score") agree with the computed values;
//   (b) deixis: "this curve", "here", "notice" have ink within N words;
//   (d) exact geometry: a line called tangent touches its circle; a point said to be on a circle is;
//   (e) erasure: no clear; fade/move only as a declared teaching move;
//   (f) tags: none malformed or skipped inside the beat.
// Layout (c) lives in layout.ts; the runner merges its flags into the verdict.
import { mentions, matches, type Mention } from './numbers';
import type { Beat, Tag, Word } from './segment';
import { NEW_INK } from './segment';
import type { GateState, Value } from './engine';

export type CheckKind = 'number' | 'threshold' | 'direction' | 'deixis' | 'layout' | 'geometry' | 'erasure' | 'tag' | 'unbound' | 'order' | 'named' | 'svg';
export type Flag = { check: CheckKind; detail: string };
export type Verdict = { ok: boolean; flags: Flag[]; notes: string[] };

export const NUMBER_FAMILY = new Set<CheckKind>(['number', 'threshold', 'direction']);

// ------------------------------------------------------------------------------------------------
// (a) numbers

/** Small integers are counts ("two points", "three images"): exempt unless stated as a percentage. */
const isSmallCount = (m: Mention) => (!m.percent && !m.frac && m.dp === 0 && Number.isInteger(m.value) && Math.abs(m.value) <= 12)
  // "its two halves", "three thirds": parts of a whole, counted (the fraction is exactly 1).
  || (!!m.frac && !m.percent && m.value === 1);
const isYear = (m: Mention) => !m.spelled && m.dp === 0 && m.value >= 1900 && m.value <= 2100;

/** One arithmetic step from the known values: what narration may state without the board showing it. */
export function derivedValues(core: number[], page: number[]): number[] {
  const u = [...new Set(core.filter(Number.isFinite).map((v) => +v.toPrecision(12)))].slice(0, 80);
  const out: number[] = [];
  for (const a of u) {
    out.push(1 - a, a * 100, a / 100, a * 2, a / 2, a * a, Math.sqrt(Math.abs(a)));
    for (const b of u) { if (a === b) continue; out.push(a + b, a - b, a * b); if (b) out.push(a / b); }
  }
  for (const p of [...new Set(page)].slice(0, 400)) out.push(p * 2, p / 2, p * 100, p / 100, 1 - p);
  return out.filter(Number.isFinite);
}

/**
 * `pageImage`: the beat points at a page equation, image or figure mark (#e, #i, #g): its numbers may
 * be read off the page image, which has no text layer, so an unmatched number there is unverifiable
 * (a note), not a failure.
 */
export type NumberCtx = { known: Value[]; derived: number[]; intersections: number[]; pageImage?: boolean };

export function checkNumbers(words: readonly string[], ctx: NumberCtx): { flags: Flag[]; notes: string[] } {
  const flags: Flag[] = [], notes: string[] = [];
  for (const m of mentions(words)) {
    if (m.ref || isSmallCount(m) || isYear(m)) continue;
    const direct = ctx.known.find((k) => matches(m, k.v)) ?? (ctx.intersections.some((v) => matches(m, v)) ? { source: 'computed', of: 'plot intersection' } as Value : undefined);
    if (direct) continue;
    if (ctx.derived.some((v) => matches(m, v))) { notes.push(`"${m.text}" is one step from known values`); continue; }
    if (ctx.pageImage) { notes.push(`"${m.text}" unverifiable: the beat points at a page equation/image with no text layer`); continue; }
    const near = ctx.known.reduce<Value | null>((best, k) => (best == null || Math.abs(k.v - m.value) < Math.abs(best.v - m.value) ? k : best), null);
    flags.push({ check: 'number', detail: `"${m.text}" matches no page, literal or computed value${near ? ` (nearest: ${+near.v.toPrecision(4)} from ${near.source} ${near.of})` : ''}` });
  }
  return { flags, notes };
}

/**
 * Step 2 (bound numbers): a number the narration types that equals a value only the engine has (a
 * computed cell, a calc result, a readout, a formula constant) should have been a {{val}}: flagged
 * `unbound`. A {{val}} is never a typed word, so bound numbers pass by construction. Numbers that
 * also match the page, the question or a literal the model wrote are the model's own: not flagged.
 */
export function checkUnbound(words: readonly string[], known: readonly Value[]): Flag[] {
  const flags: Flag[] = [];
  for (const m of mentions(words)) {
    if (m.ref || m.approx || isSmallCount(m) || isYear(m)) continue;
    const hits = known.filter((k) => matches(m, k.v));
    if (!hits.length || hits.some((k) => k.source !== 'computed')) continue;
    flags.push({ check: 'unbound', detail: `"${m.text}" is the engine's ${hits[0].of}: say it with {{val id=${hits[0].of}}}` });
  }
  return flags;
}

/**
 * Constants before statements: a number the narration states that equals a constant's literal
 * declared more than `ahead` beats later (the narration leans on a number the engine has not been
 * given yet). `consts`: each declared literal, with the beat of its {{const}}.
 */
export function checkOrder(words: readonly string[], beat: number, consts: readonly { name: string; v: number; beat: number }[], ahead = 1): Flag[] {
  const flags: Flag[] = [];
  for (const m of mentions(words)) {
    if (m.ref || isSmallCount(m) || isYear(m)) continue;
    const c = consts.find((k) => matches(m, k.v) && k.beat > beat + ahead);
    if (c && !consts.some((k) => matches(m, k.v) && k.beat <= beat + ahead)) flags.push({ check: 'order', detail: `"${m.text}" is constant ${c.name}, declared ${c.beat - beat} beats later: declare it first` });
  }
  return flags;
}

const BELOW = /^(below|under|less|lower|smaller|fewer|beneath|at most|no more)$/;
const ABOVE = /^(above|over|more|greater|higher|larger|bigger|exceeds?|exceeding|at least|beyond)$/;
const clauses = (ws: readonly string[]): [number, number][] => {
  const out: [number, number][] = [];
  let s = 0;
  ws.forEach((w, i) => { if (/[;:]$/.test(w) || /[.!?]$/.test(w)) { out.push([s, i]); s = i + 1; } });
  if (s < ws.length) out.push([s, ws.length - 1]);
  return out;
};
const lc = (w: string) => w.toLowerCase().replace(/[^a-z%-]/g, '');

/**
 * Threshold claims bound to a computed table row: "<row key> … below/above <number>". The row whose
 * cell equals the key is looked up among tables with computed columns; the computed cell must agree.
 * Without a key, a single computed value new in this beat is checked.
 */
export function checkThresholds(words: readonly string[], state: GateState, beat: number): Flag[] {
  const flags: Flag[] = [];
  const ms = mentions(words);
  const rows = state.values.filter((v) => v.row && v.source === 'computed');
  const fresh = state.values.filter((v) => v.beat === beat && v.source === 'computed' && !v.row);
  for (const [c0, c1] of clauses(words)) {
    const inClause = ms.filter((m) => m.w0 >= c0 && m.w1 <= c1);
    for (const m of inClause) {
      const p1 = lc(words[m.w0 - 1] ?? ''), p2 = `${lc(words[m.w0 - 2] ?? '')} ${p1}`;
      const p0 = (p1 === 'than' ? lc(words[m.w0 - 2] ?? '') : BELOW.test(p2) || ABOVE.test(p2) ? p2 : p1);
      const dir = BELOW.test(p0) ? 'below' : ABOVE.test(p0) ? 'above' : null;
      if (!dir) continue;
      const keys = inClause.filter((k) => k !== m && k.w1 < m.w0);
      let cands: { v: number; why: string }[] = [];
      for (const k of keys) for (const r of rows) if (r.row!.cells.some((c, j) => j !== r.row!.cells.length && Math.abs(c - k.value) < 1e-9) && Math.abs(r.v - k.value) > 1e-9) cands.push({ v: r.v, why: `${r.of} at ${k.text}` });
      if (!cands.length && !keys.length && fresh.length === 1) cands = [{ v: fresh[0].v, why: fresh[0].of }];
      for (const c of cands) {
        // The threshold in the computed value's scale: 1% is 0.01 or 1.
        const ts = m.percent ? [m.value / 100, m.value] : [m.value];
        const t = ts.reduce((b, x) => (Math.abs(Math.log(Math.abs(c.v) / Math.abs(x) || 1)) < Math.abs(Math.log(Math.abs(c.v) / Math.abs(b) || 1)) ? x : b));
        const ok = dir === 'below' ? c.v < t : c.v > t;
        if (!ok) flags.push({ check: 'threshold', detail: `"${words.slice(Math.max(c0, m.w0 - 4), m.w1 + 1).join(' ')}" but ${c.why} is ${+c.v.toPrecision(4)}` });
      }
    }
  }
  return flags;
}

const DOWN = /^(lower|smaller|less|fewer|decreases?|falls?|drops?|shrinks?|declines?|reduces?|weaker)$/;
const UP = /^(higher|larger|greater|bigger|increases?|rises?|grows?|stronger)$/;
const stem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');

/**
 * Direction claims about a computed table column named in the clause ("Harris gives the edge-like
 * patch a lower score"): the claim is read as later row vs first row and must match the computed
 * values' order. Clauses with both directions, or a number after the comparative (a threshold), are skipped.
 */
export function checkDirections(words: readonly string[], state: GateState, beat: number): Flag[] {
  const flags: Flag[] = [];
  const cols = new Map<string, number[]>();
  for (const v of state.values) if (v.row && v.beat === beat) { const k = v.of; cols.set(k, [...(cols.get(k) ?? []), v.v]); }
  if (!cols.size) return flags;
  const ms = mentions(words);
  for (const [c0, c1] of clauses(words)) {
    const ws = words.slice(c0, c1 + 1).map(lc);
    const stems = new Set(words.slice(c0, c1 + 1).map(stem));
    const dirs = ws.map((w, i) => (DOWN.test(w) ? -1 : UP.test(w) ? 1 : 0) as number).map((d, i) => (d && ms.some((m) => m.w0 === c0 + i + 1 || m.w0 === c0 + i + 2) ? 0 : d));
    const d = dirs.filter((x) => x !== 0);
    if (!d.length || d.some((x) => x !== d[0])) continue;
    for (const [name, vs] of cols) {
      const head = name.split('.').slice(1).join('.');
      if (!head || !stems.has(stem(head)) || vs.length < 2) continue;
      const delta = vs[vs.length - 1] - vs[0];
      if (Math.abs(delta) < 1e-9 * Math.max(1, Math.abs(vs[0]))) continue;
      if (Math.sign(delta) !== d[0]) flags.push({ check: 'direction', detail: `"${words.slice(c0, c1 + 1).join(' ')}" says ${d[0] > 0 ? 'higher' : 'lower'}, but ${name} goes ${vs.map((v) => +v.toPrecision(3)).join(' → ')}` });
    }
  }
  return flags;
}

// ------------------------------------------------------------------------------------------------
// (b) deixis

// Demonstratives that point: "this/these <visual noun>" (one adjective may sit between), and
// "that/those" only with a drawn-thing noun ("that line"); "that value", "those starting values" are
// usually anaphora. "here" points when it is "here is/are/’s" or ends a clause ("the fifth score
// here,"); a sentence-initial "Here, …" / "Here b is zero" means "in this case".
const VISUAL_THIS = /^(line|lines|curve|curves|point|points|dot|dots|arrow|arrows|box|boxes|bar|bars|cell|cells|column|columns|row|rows|table|segment|segments|branch|interval|intervals|region|patch|window|edge|graph|plot|axis|label|shape|triangle|circle|angle|vector|vectors|path|grid|mark|spot|area|corner|arc|boundary|equation|formula|term|figure|diagram|picture|sketch|curve’s|line’s)$/;
const VISUAL_THAT = /^(line|curve|arrow|point|dot|bar|box|cell|segment|angle|label|arc|vector)$/;

/** Deictic words and where they are (word index within the beat). */
export function deictics(words: readonly string[]): { i: number; text: string }[] {
  const out: { i: number; text: string }[] = [];
  const w = words.map(lc);
  const sentenceStart = (i: number) => i === 0 || /[.!?:]["”’)]*$/.test(words[i - 1]);
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 'here' || w[i] === 'heres') {
      const heres = w[i] === 'heres' || /^(is|are|we)$/.test(w[i + 1] ?? '');
      const clauseEnd = /[.,;:!?]["”’)]*$/.test(words[i]) || i === w.length - 1;
      if (heres || (clauseEnd && !sentenceStart(i))) out.push({ i, text: words[i] });
    } else if (w[i] === 'notice' || (w[i] === 'look' && w[i + 1] === 'at')) out.push({ i, text: words[i] });
    else if ((w[i] === 'this' || w[i] === 'these') && (VISUAL_THIS.test(w[i + 1] ?? '') || (VISUAL_THIS.test(w[i + 2] ?? '') && !/[,.;:]$/.test(words[i + 1] ?? '')))) out.push({ i, text: `${words[i]} ${words[i + 1]}` });
    else if ((w[i] === 'that' || w[i] === 'those') && VISUAL_THAT.test(w[i + 1] ?? '')) out.push({ i, text: `${words[i]} ${words[i + 1]}` });
  }
  return out;
}

/** Ink that can answer a deictic word: new ink, or an accent on earlier ink. Not scrolls. */
const POINTS = new Set([...NEW_INK, 'emph', 'label', 'step', 'sweep', 'set', 'band', 'dist', 'col', 'level', 'move']);

export function checkDeixis(beat: Beat, window = 8, skipped: Set<Tag> = new Set()): Flag[] {
  const flags: Flag[] = [];
  const ws = beat.words.map((w) => w.text);
  const base = beat.words[0]?.i ?? 0;
  const ink = beat.tags.filter((t) => t.action && POINTS.has(t.action.kind) && !skipped.has(t)).map((t) => (t.at < 0 ? base + ws.length : t.at) - base);
  for (const d of deictics(ws)) {
    if (!ink.some((a) => a >= d.i - window && a <= d.i + window)) flags.push({ check: 'deixis', detail: `"${ws.slice(Math.max(0, d.i - 3), d.i + 4).join(' ')}" has no ink within ${window} words` });
  }
  return flags;
}

// ------------------------------------------------------------------------------------------------
// (d) exact geometry (circles; plots are not modelled)

const distToLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / L;
};
const footT = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
};

export function checkGeometry(beat: Beat, state: GateState, newIds: { segs: string[]; points: string[] }, tol = 0.02, near: (word: RegExp) => Set<string> = () => new Set(newIds.segs)): Flag[] {
  const flags: Flag[] = [];
  const text = beat.text.toLowerCase();
  if (/\btangent\b/.test(text)) {
    const close = near(/^tangent/i);
    for (const s of state.segs.filter((x) => newIds.segs.includes(x.id) && close.has(x.id))) {
      const cs = state.circles.filter((c) => c.region === s.region);
      if (!cs.length) continue;
      const onCircle = (p: { x: number; y: number }, c: (typeof cs)[number]) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) <= tol * c.r;
      // Tangent at an end that lies on the circle: the segment is perpendicular to the radius there (within ~2°).
      const perp = (p: { x: number; y: number }, q: { x: number; y: number }, c: (typeof cs)[number]) => {
        const rx = p.x - c.cx, ry = p.y - c.cy, dx = q.x - p.x, dy = q.y - p.y;
        return Math.abs(rx * dx + ry * dy) / ((Math.hypot(rx, ry) || 1) * (Math.hypot(dx, dy) || 1)) <= 0.035;
      };
      const touches = cs.some((c) => (onCircle(s.a, c) && perp(s.a, s.b, c)) || (onCircle(s.b, c) && perp(s.b, s.a, c)) || (!onCircle(s.a, c) && !onCircle(s.b, c) && Math.abs(distToLine({ x: c.cx, y: c.cy }, s.a, s.b) - c.r) <= 0.005 * c.r && (() => { const t = footT({ x: c.cx, y: c.cy }, s.a, s.b); return t >= -0.02 && t <= 1.02; })()));
      const hasTangentEnd = cs.some((c) => [s.a, s.b].some((p) => onCircle(p, c)));
      // A segment ON the tangent line (e.g. from the touch point) touches; anything else is checked only when it starts on the circle.
      if (!touches && hasTangentEnd && /tangent (line|segment)|this tangent|the tangent/.test(text)) flags.push({ check: 'geometry', detail: `${s.kind} ${s.id} is called tangent but does not touch a circle at a right angle` });
    }
  }
  if (/\bon (the|a|this) (unit )?circle\b/.test(text)) {
    for (const p of state.points.filter((x) => newIds.points.includes(x.id))) {
      const cs = state.circles.filter((c) => c.region === p.region);
      if (!cs.length) continue;
      if (!cs.some((c) => Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r) <= tol * c.r || Math.hypot(p.x - c.cx, p.y - c.cy) < 1)) flags.push({ check: 'geometry', detail: `point ${p.text ?? p.id} is said to be on the circle but sits off it` });
    }
  }
  return flags;
}

// ------------------------------------------------------------------------------------------------
// (e) erasure, (f) tags

const TEACHING_MOVE = /\b(move|moves|moving|slide|slides|shift|shifts|drag|fade|fades|set aside|remove|replace|instead|now)\b/i;

export function checkErasure(beat: Beat): Flag[] {
  const flags: Flag[] = [];
  for (const t of beat.tags) {
    const k = t.action?.kind;
    if (k === 'clear') flags.push({ check: 'erasure', detail: 'clear erases committed ink' });
    if (k === 'fade' || k === 'move') {
      const u = beat.units.find((x) => x.tags.includes(t));
      if (!u || !TEACHING_MOVE.test(u.text)) flags.push({ check: 'erasure', detail: `${k} ${(t.action as { ref?: string }).ref ?? ''} without a declared teaching move in its sentence` });
    }
  }
  return flags;
}

export function checkTags(beat: Beat, skipped: Map<Tag, string>): Flag[] {
  const flags: Flag[] = [];
  for (const t of beat.tags) {
    if (!t.action) flags.push({ check: 'tag', detail: `malformed {{${t.body.slice(0, 60)}}}` });
    else if (skipped.has(t)) flags.push({ check: 'tag', detail: `${t.action.kind} skipped: ${skipped.get(t)}` });
  }
  return flags;
}

export type Words = Word[];

// ------------------------------------------------------------------------------------------------
// Named objects: the narration names a drawn thing the board doesn't have.

/** What the board (and the slides the answer points at) carry, for checkNamed. */
export type NamedScene = {
  /** Labels and ids of drawn elements (points' and labels' text, ids), case-sensitive. */
  labels: Set<string>;
  /** Drawn elements per kind ('point', 'line', 'curve', 'circle', 'arrow', 'triangle', 'table', 'grid'…). */
  counts: Map<string, number>;
  /** Words printed on the pages in play: a label that is on the slide is not the board's to draw. */
  pageWords?: Set<string>;
};

const NAMED_NOUN: Record<string, string> = {
  point: 'point', vertex: 'point', curve: 'curve', line: 'line', segment: 'line', triangle: 'triangle', circle: 'circle', arrow: 'arrow', vector: 'arrow',
};
const PLURAL_NOUN: Record<string, string> = {
  points: 'point', dots: 'point', curves: 'curve', plots: 'curve', lines: 'line', segments: 'line', triangles: 'triangle', circles: 'circle', arrows: 'arrow', tables: 'table', grids: 'grid',
};
const COUNT_WORD: Record<string, number> = { two: 2, both: 2, three: 3, four: 4, five: 5, six: 6 };
const clean = (w: string) => w.replace(/^[("“‘']+|[)"”’'.,;:!?]+$/g, '');

/**
 * (g) named objects. A labelled reference ("point C", "curve D", "triangle ABC") with no drawn
 * element or page word carrying that label, and a determined count ("the two triangles", "these
 * three points", "both curves") above what is drawn. Generic statements ("a point", "two points
 * determine a line") are never flagged: only a label of capitals, or a count after the/these/those/both.
 */
export function checkNamed(words: readonly string[], scene: NamedScene): Flag[] {
  const flags: Flag[] = [];
  const has = (l: string) => scene.labels.has(l) || scene.labels.has(l.toLowerCase()) || !!scene.pageWords?.has(l);
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i]).toLowerCase();
    const noun = NAMED_NOUN[w];
    if (noun) {
      const raw = words[i + 1] ?? '';
      const label = clean(raw);
      // A label: 1–3 capitals (primes, subscript digits) — "C", "C′", "ABC", "P1".
      if (/^[A-Z](?:[A-Z]{0,2}|[′']|\d)?$/.test(label) && !/^(A|I)$/.test(label)) {
        const parts = noun === 'triangle' && label.length === 3 ? [label, ...label.split('')] : [label];
        const ok = noun === 'triangle' && label.length === 3 ? parts.slice(1).every(has) || has(label) : has(label);
        if (!ok) flags.push({ check: 'named', detail: `"${words[i]} ${raw}": nothing drawn is labelled ${label}` });
      }
    }
  }
  return flags;
}

/**
 * A determined count ("the two triangles", "these three points", "both curves") above what is drawn.
 * Precision on the recorded corpus is low (the count often means the slide's own figure, or is
 * generic: "both points in one sample"), so the gate notes it and does not fail on it.
 */
export function checkCounts(words: readonly string[], scene: NamedScene): Flag[] {
  const flags: Flag[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i]).toLowerCase();
    if (/^(the|these|those)$/.test(w) || w === 'both') {
      const nWord = w === 'both' ? 'both' : clean(words[i + 1] ?? '').toLowerCase();
      const n = COUNT_WORD[nWord];
      const kind = PLURAL_NOUN[clean(words[i + (w === 'both' ? 1 : 2)] ?? '').toLowerCase()];
      if (!n || !kind) continue;
      const have = scene.counts.get(kind) ?? 0;
      if (have < n) flags.push({ check: 'named', detail: `"${words.slice(i, i + (w === 'both' ? 2 : 3)).join(' ')}": ${have} ${kind}${have === 1 ? '' : 's'} drawn` });
    }
  }
  return flags;
}
