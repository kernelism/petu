// src/gate/verdict.ts — one beat's verdict: the composition of the gate's checks (check.ts,
// layout.ts) over a beat whose actions are applied to the engine state here. One implementation for
// the offline gate (scripts/gate-beats/gateRun.ts) and the live gate's preflight (src/gate/live.ts).
import { svgTextWords } from '../svgboard/check';
import { boardNumbers, checkDeixis, checkDirections, checkErasure, checkCounts, checkGeometry, checkNamed, checkNumbers, checkOrder, checkTags, checkThresholds, checkUnbound, derivedValues, type Flag, type NamedScene, type Verdict } from './check';
import { checkLayout, checkPageText, type El, type LayoutFlag, type Rect } from './layout';
import type { GateState } from './engine';
import type { Beat, Tag } from './segment';
import type { RawAction } from '../script/types';

/**
 * SEVERITY: which checks fail a unit (it is not released) and which only note (logged, in ?debug and
 * the eval). `default` fails only what is measured or mechanical: a skipped or unparsable action (tag),
 * erasing released ink (erasure), a labelled reference to nothing drawn (named). A number typed that
 * equals the engine's value (unbound) only notes: the student hears the number the board shows, so
 * the sentence does not mislead (founder lec06, 2026-10-31: every sentence that said a computed value
 * right was dropped, most of the answer). A number said close to an svg readout but not it (drift, check.ts
 * boardNumbers) fails: it is not a right number said unbound but a wrong one beside the board's, and the
 * one-candidate case is rewritten before it can fail (live.ts). Deixis, the number family, geometry and every layout check note until
 * their precision on the recorded corpus is measured (gate-beats: 19% false flags on clean beats).
 * `design` is the design's table (2026-10-29 §3; `&gatecheck=all`).
 */
export type Severity = 'default' | 'design';
export const SEVERITY: Record<Severity, Record<Flag['check'], 'fail' | 'note'>> = {
  default: { tag: 'fail', unbound: 'note', erasure: 'fail', named: 'fail', deixis: 'note', number: 'note', threshold: 'note', direction: 'note', geometry: 'note', layout: 'note', order: 'note', svg: 'fail', drift: 'fail' },
  design: { tag: 'fail', unbound: 'fail', erasure: 'fail', named: 'fail', deixis: 'fail', number: 'fail', threshold: 'fail', direction: 'fail', geometry: 'fail', layout: 'fail', order: 'note', svg: 'fail', drift: 'fail' },
};

/** A verdict under a severity: flags whose check only notes move to the notes. */
export function withSeverity(v: Verdict, sev: Severity = 'default'): Verdict {
  const t = SEVERITY[sev];
  const flags = v.flags.filter((f) => t[f.check] === 'fail');
  const notes = [...v.notes, ...v.flags.filter((f) => t[f.check] !== 'fail').map((f) => `${f.check}: ${f.detail}`)];
  return { ok: flags.length === 0, flags, notes };
}

/** Layout kinds that only note even under the design severity (design §3 SEVERITY). */
export const NOTE_LAYOUT = new Set<LayoutFlag['kind']>(['small-text', 'bar-labels', 'label-far']);
/** Checks that only note (order: a constant stated a beat early). */
export const NOTE_CHECKS = new Set<Flag['check']>(['order']);

/** A registry entry (as the eval records it, or as the shadow board's registry has it). */
export type RegEntry = { id: string; kind: string; target: { page?: number; region?: string }; bbox: Rect; boxes: Rect[]; strokes?: { x: number; y: number }[][] };

const normId = (s?: string) => s?.replace(/-/g, '_');

/** A registry entry as a layout element (text boxes, chart groups, what a label annotates). */
export function toEl(e: RegEntry, a: RawAction): El {
  const kit = e.kind.startsWith('kit-');
  const textKinds = new Set(['write', 'label', 'math', 'annot']);
  // A kit block's box is its text (cells, numerals); an engine plot's box is a chart that labels sit on by design.
  const text = kit && a.kind !== 'plot' ? [e.bbox] : kit ? [] : e.kind === 'point' ? e.boxes.slice(1) : textKinds.has(e.kind) ? e.boxes : [];
  const x = a as unknown as { labels?: string[]; ref?: string; at?: { ref?: string }; axes?: string; id?: string };
  return {
    id: e.id, kind: e.kind, region: e.target.region, page: e.target.page, bbox: e.bbox, boxes: e.boxes, strokes: e.strokes ?? [], text,
    ...(x.axes || a.kind === 'plot' ? { group: normId(x.axes) ?? e.id } : {}),
    ...(a.kind === 'bars' && x.labels?.length ? { barLabels: x.labels } : {}),
    ...(a.kind === 'label' && x.ref ? { annotates: normId(x.ref) } : {}),
    ...(a.kind === 'box' && x.at && typeof x.at === 'object' && 'ref' in x.at && x.at.ref ? { annotates: String(x.at.ref).replace(/\[.*$/, '') } : {}),
  };
}

/** What a beat's named references are checked against: the drawn actions' labels, ids and kinds. */
export function namedScene(drawn: readonly RawAction[], pageWords?: Set<string>): NamedScene {
  const labels = new Set<string>(), counts = new Map<string, number>();
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const a of drawn) {
    const x = a as unknown as { id?: string; text?: string; label?: string; pts?: unknown[]; names?: Record<string, unknown>; defs?: [string, string][] };
    if (x.id) labels.add(x.id);
    if (typeof x.text === 'string') for (const t of x.text.split(/[\s,=()]+/)) if (t) labels.add(t);
    if (typeof x.label === 'string') labels.add(x.label);
    if (a.kind === 'let' && x.names) for (const n of Object.keys(x.names)) labels.add(n);
    if (a.kind === 'svg') for (const w of svgTextWords(a.svg)) labels.add(w);
    if (a.kind === 'let' && Array.isArray(x.defs)) for (const [n] of x.defs) labels.add(n);
    if (a.kind === 'point') bump('point');
    else if (a.kind === 'line') bump('line');
    else if (a.kind === 'arrow') bump('arrow');
    else if (a.kind === 'circle') bump('circle');
    else if (a.kind === 'plot' || a.kind === 'curve') bump('curve');
    else if (a.kind === 'shade' && Array.isArray(x.pts) && x.pts.length === 3) bump('triangle');
    else if (a.kind === 'table' || a.kind === 'grid') bump(a.kind);
    else if (a.kind === 'scatter') bump('point');
  }
  return { labels, counts, ...(pageWords ? { pageWords } : {}) };
}

export type BeatInput = {
  beat: Beat;
  /** The beat's index (the engine's beat clock). */
  k: number;
  /** The engine state before the beat: the beat's actions are applied to it here (skipped ones not). */
  state: GateState;
  /** Tags the board skipped (live director, shadow board, or an injected fault), with the reason. */
  skipped: Map<Tag, string>;
  /** Elements the beat added (registry boxes), and those already drawn. */
  added: El[];
  drawn: El[];
  /** Numbers on the pages in play. */
  pageVals: number[];
  /** Constants as declared over the whole answer so far (the constants-before-statements check). */
  consts: { name: string; v: number; beat: number }[];
  /** A page's text lines in target space, for annotations covering page text. */
  lines?: (page: number) => Rect[] | undefined;
  /** Named-object check: the board's labels and kinds (namedScene). Absent: not checked. */
  scene?: NamedScene;
};

/** Every check over one beat; flags fail it, notes don't. Mutates `state` (the beat is applied). */
export function checkBeat(i: BeatInput): Verdict {
  const { beat, k, state, skipped } = i;
  for (const t of beat.tags) if (t.action) state.note(t.action);
  const segsBefore = new Set(state.segs.map((s) => s.id)), ptsBefore = new Set(state.points.map((p) => p.id));
  const flags: Flag[] = [];
  const notes: string[] = [];
  const made = new Map<Tag, string>();
  for (const t of beat.tags) {
    if (!t.action || skipped.has(t)) continue;
    let why: string | undefined;
    try { why = state.apply(t.action, k); } catch (e) { why = e instanceof Error ? e.message : String(e); }
    if (state.lastId) made.set(t, state.lastId);
    // A bound number the engine cannot resolve is shown as a dash: the beat fails.
    if (why && t.action.kind === 'val') flags.push({ check: 'tag', detail: `{{val id=${t.action.ref}}} unbound: ${why}` });
    else if (why) notes.push(`offline engine could not apply ${t.action.kind}: ${why}`);
  }
  // Shapes drawn within 4 words of a word (for claims like "tangent").
  const near = (re: RegExp) => {
    const b0 = beat.words[0]?.i ?? 0;
    const at = beat.words.filter((w) => re.test(w.text)).map((w) => w.i);
    return new Set([...made].filter(([t]) => at.some((n) => Math.abs((t.at < 0 ? b0 + beat.words.length : t.at) - n) <= 4)).map(([, id]) => id));
  };
  const ws = beat.words.map((w) => w.text);
  const core = state.values.filter((v) => v.source !== 'page').map((v) => v.v);
  const inter = state.intersections().flatMap((p) => [p.x, p.y]);
  const num = checkNumbers(ws, { known: state.values, derived: derivedValues([...core, ...inter], i.pageVals), intersections: inter, pageImage: beat.tags.some((t) => /\bmark=#[eig]\d/.test(t.body)) });
  flags.push(...num.flags, ...checkThresholds(ws, state, k), ...checkDirections(ws, state, k));
  flags.push(...checkUnbound(ws, state.values));
  // Numbers said against the board's readouts: near and not equal fails; one clear candidate is a fix (live.ts applies it).
  const bn = boardNumbers(beat.words, state.values, k);
  flags.push(...bn.flags);
  if (bn.fixes.length) notes.push(`said as the board's: ${bn.fixes.map((f) => `${f.from} → ${f.to}`).join(', ')}`);
  for (const f of checkOrder(ws, k, i.consts)) (NOTE_CHECKS.has(f.check) ? notes.push(`${f.check}: ${f.detail}`) : flags.push(f));
  notes.push(...num.notes);
  flags.push(...checkDeixis(beat, 8, new Set(skipped.keys())));
  flags.push(...checkGeometry(beat, state, { segs: state.segs.filter((s) => !segsBefore.has(s.id)).map((s) => s.id), points: state.points.filter((p) => !ptsBefore.has(p.id)).map((p) => p.id) }, 0.02, near));
  flags.push(...checkErasure(beat), ...checkTags(beat, skipped));
  if (i.scene) { flags.push(...checkNamed(ws, i.scene)); notes.push(...checkCounts(ws, i.scene).map((f) => `named count: ${f.detail}`)); }
  for (const f of [...checkLayout(i.added, i.drawn), ...(i.lines ? checkPageText(i.added, i.lines) : [])]) {
    if (NOTE_LAYOUT.has(f.kind)) notes.push(`layout ${f.kind}: ${f.detail}`);
    else flags.push({ check: 'layout', detail: `${f.kind}: ${f.detail}` });
  }
  return { ok: flags.length === 0, flags, notes };
}
