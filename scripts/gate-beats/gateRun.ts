// scripts/gate-beats/gateRun.ts — runs the commit gate offline over one recorded answer: beats,
// engine state replayed beat by beat, layout from the recorded registry, live skips from the
// recorded timings. Pure given its inputs (the PDF grounding is passed in).
import { beats as segment, tokenize, type Beat, type Tag } from '../../src/gate/segment.ts';
import { GateState } from '../../src/gate/engine.ts';
import { checkDeixis, checkDirections, checkErasure, checkGeometry, checkNumbers, checkOrder, checkTags, checkThresholds, checkUnbound, derivedValues, type Flag, type Verdict } from '../../src/gate/check.ts';
import { checkLayout, checkPageText, type El, type Rect } from '../../src/gate/layout.ts';
import { textNumbers } from '../../src/gate/numbers.ts';
import type { Grounding } from '../../src/geometry/resolve.ts';
import type { RawAction } from '../../src/script/types.ts';
import type { Recording, RecEntry } from './recordings.ts';

export type BeatResult = { k: number; opener: boolean; text: string; tags: string[]; verdict: Verdict; start: number; end: number };
export type AnswerResult = { label: string; question: string; beats: BeatResult[] };
export type PageText = Map<number, string>;

const CREATES = new Set(['annot', 'lift', 'highlight', 'underline', 'circle', 'box', 'line', 'arrow', 'curve', 'point', 'write', 'math', 'shade', 'angle', 'brace', 'axes', 'plot', 'grid', 'bars', 'scatter', 'table', 'calc', 'fit', 'connect', 'label']);
const normId = (s?: string) => s?.replace(/-/g, '_');

/** Global actions in stream order, each with the live skip reason (timings exclude let/const and malformed tags). */
export function liveSkips(script: string, timings: Recording['timings']): Map<number, string> {
  const tags = tokenize(script).filter((t): t is Tag => t.kind === 'tag' && t.action != null && t.action.kind !== 'let' && t.action.kind !== 'const');
  const out = new Map<number, string>();
  let j = 0;
  for (const t of tags) {
    let k = j;
    while (k < timings.length && k < j + 4 && timings[k].action?.kind !== t.action!.kind) k++;
    if (k < timings.length && timings[k].action?.kind === t.action!.kind) { if (timings[k].skipped) out.set(t.start, timings[k].skipped!); j = k + 1; }
  }
  return out;
}

/** Registry entries matched to the tags that drew them (by id, else by kind in order). */
export function entriesByTag(script: string, registry: RecEntry[], skips: Map<number, string>): Map<number, RecEntry> {
  const used = new Set<RecEntry>();
  const out = new Map<number, RecEntry>();
  let cursor = 0;
  for (const t of tokenize(script)) {
    if (t.kind !== 'tag' || !t.action || skips.has(t.start)) continue;
    const a = t.action as RawAction & { id?: string };
    const isLabelRef = a.kind === 'label' && 'ref' in a;
    if (!CREATES.has(a.kind) || ('ref' in a && !isLabelRef)) continue;
    const want = [a.kind, `kit-${a.kind}`];
    let e = a.id ? registry.find((r) => !used.has(r) && r.id === normId(a.id)) : undefined;
    if (!e) { const i = registry.findIndex((r, n) => n >= cursor && !used.has(r) && r.id.startsWith('_') && want.includes(r.kind)); if (i >= 0) { e = registry[i]; cursor = i + 1; } }
    if (!e) { const i = registry.findIndex((r) => !used.has(r) && want.includes(r.kind) && (!a.id || r.id.startsWith('_'))); if (i >= 0) e = registry[i]; }
    if (e) { used.add(e); out.set(t.start, e); }
  }
  return out;
}

function toEl(e: RecEntry, a: RawAction): El {
  const kit = e.kind.startsWith('kit-');
  const textKinds = new Set(['write', 'label', 'math', 'annot']);
  const text = kit ? [e.bbox] : e.kind === 'point' ? e.boxes.slice(1) : textKinds.has(e.kind) ? e.boxes : [];
  const x = a as unknown as { labels?: string[]; ref?: string; at?: { ref?: string }; axes?: string; id?: string };
  return {
    id: e.id, kind: e.kind, region: e.target.region, page: e.target.page, bbox: e.bbox, boxes: e.boxes, strokes: e.strokes ?? [], text,
    ...(x.axes || a.kind === 'plot' ? { group: normId(x.axes) ?? e.id } : {}),
    ...(a.kind === 'bars' && x.labels?.length ? { barLabels: x.labels } : {}),
    ...(a.kind === 'label' && x.ref ? { annotates: normId(x.ref) } : {}),
    ...(a.kind === 'box' && x.at && typeof x.at === 'object' && 'ref' in x.at && x.at.ref ? { annotates: String(x.at.ref).replace(/\[.*$/, '') } : {}),
  };
}

/** `lines`: a page's text lines in target space (x 0–1000, y × the page's aspect), for page annotations. */
export type GateEnv = { pages: PageText; grounding?: Grounding; lines?: (page: number) => Rect[] | undefined };

/** Beats of an answer: the opener's (spoken before stage 2; reported, not gated) then stage 2's. */
export function answerBeats(rec: Pick<Recording, 'script' | 'stage2At'>): { beat: Beat; base: number; opener: boolean }[] {
  const out: { beat: Beat; base: number; opener: boolean }[] = [];
  if (rec.stage2At > 0) for (const b of segment(rec.script.slice(0, rec.stage2At))) out.push({ beat: b, base: 0, opener: true });
  for (const b of segment(rec.script.slice(rec.stage2At))) out.push({ beat: b, base: rec.stage2At, opener: false });
  return out;
}

export function gateAnswer(rec: Recording, env: GateEnv): AnswerResult {
  const state = new GateState(env.grounding);
  const pageVals: number[] = [];
  for (const [p, txt] of env.pages) { const vs = textNumbers(txt); pageVals.push(...vs); state.addValues(vs, 'page', `p${p}`, -1); }
  state.addValues(textNumbers(rec.question), 'question', 'question', -1);
  const skips = liveSkips(rec.script, rec.timings);
  const entries = entriesByTag(rec.script, rec.registry, skips);
  const all = answerBeats(rec);
  // Constants as declared (their literal values and beats), for the constants-before-statements check.
  const consts = all.flatMap(({ beat }, k) => beat.tags.flatMap((t) => (t.action?.kind === 'const' ? t.action.defs.filter(([, v]) => /^[-−+]?\d*\.?\d+$/.test(v.trim())).map(([name, v]) => ({ name, v: Number(v.replace('−', '-')), beat: k })) : [])));
  const drawn: El[] = [];
  const results: BeatResult[] = [];
  // Lookahead: the director notes names a little ahead; the gate sees the whole beat before release.
  for (const [k, { beat, base, opener }] of all.entries()) {
    const skipped = new Map<Tag, string>();
    for (const t of beat.tags) { const r = skips.get(base + t.start); if (r) skipped.set(t, r); }
    for (const t of beat.tags) if (t.action) state.note(t.action);
    const segsBefore = new Set(state.segs.map((s) => s.id)), ptsBefore = new Set(state.points.map((p) => p.id));
    const flags: Flag[] = [];
    const notes: string[] = [];
    const made = new Map<Tag, string>();
    for (const t of beat.tags) {
      if (!t.action || skipped.has(t)) continue;
      const why = state.apply(t.action, k);
      if (state.lastId) made.set(t, state.lastId);
      // A bound number the engine cannot resolve is shown as a dash: the beat fails.
      if (why && t.action.kind === 'val') flags.push({ check: 'tag', detail: `{{val id=${t.action.ref}}} unbound: ${why}` });
      else if (why) notes.push(`offline engine could not apply ${t.action.kind}: ${why}`);
    }
    // Shapes drawn within 4 words of a word (for claims like "tangent").
    const near = (re: RegExp) => {
      const b0 = beat.words[0]?.i ?? 0;
      const at = beat.words.filter((w) => re.test(w.text)).map((w) => w.i);
      return new Set([...made].filter(([t]) => at.some((i) => Math.abs((t.at < 0 ? b0 + beat.words.length : t.at) - i) <= 4)).map(([, id]) => id));
    };
    const ws = beat.words.map((w) => w.text);
    const core = state.values.filter((v) => v.source !== 'page').map((v) => v.v);
    const inter = state.intersections().flatMap((p) => [p.x, p.y]);
    const num = checkNumbers(ws, { known: state.values, derived: derivedValues([...core, ...inter], pageVals), intersections: inter, pageImage: beat.tags.some((t) => /\bmark=#[eig]\d/.test(t.body)) });
    flags.push(...num.flags, ...checkThresholds(ws, state, k), ...checkDirections(ws, state, k));
    flags.push(...checkUnbound(ws, state.values), ...checkOrder(ws, k, consts));
    notes.push(...num.notes);
    flags.push(...checkDeixis(beat, 8, new Set(skipped.keys())));
    flags.push(...checkGeometry(beat, state, { segs: state.segs.filter((s) => !segsBefore.has(s.id)).map((s) => s.id), points: state.points.filter((p) => !ptsBefore.has(p.id)).map((p) => p.id) }, 0.02, near));
    flags.push(...checkErasure(beat), ...checkTags(beat, skipped));
    const added: El[] = [];
    for (const t of beat.tags) { const e = entries.get(base + t.start); if (e && t.action) added.push(toEl(e, t.action)); }
    for (const f of [...checkLayout(added, drawn), ...(env.lines ? checkPageText(added, env.lines) : [])]) flags.push({ check: 'layout', detail: `${f.kind}: ${f.detail}` });
    drawn.push(...added);
    results.push({ k, opener, text: beat.text, tags: beat.tags.map((t) => t.action?.kind ?? '?malformed'), verdict: { ok: flags.length === 0, flags, notes }, start: base + beat.start, end: base + beat.end });
  }
  return { label: `${rec.run}/${rec.q}`, question: rec.question, beats: results };
}
