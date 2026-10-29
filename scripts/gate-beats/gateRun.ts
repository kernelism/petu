// scripts/gate-beats/gateRun.ts — runs the commit gate offline over one recorded answer: beats,
// engine state replayed beat by beat, layout from the recorded registry, live skips from the
// recorded timings. Pure given its inputs (the PDF grounding is passed in).
import { beats as segment, tokenize, type Beat, type Tag } from '../../src/gate/segment.ts';
import { GateState } from '../../src/gate/engine.ts';
import type { Verdict } from '../../src/gate/check.ts';
import type { El, Rect } from '../../src/gate/layout.ts';
import { checkBeat, namedScene, toEl } from '../../src/gate/verdict.ts';
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
  const pageWords = new Set([...env.pages.values()].flatMap((t) => t.split(/[^\p{L}\p{N}′']+/u)).filter(Boolean));
  const acted: RawAction[] = [];
  for (const [k, { beat, base, opener }] of all.entries()) {
    const skipped = new Map<Tag, string>();
    for (const t of beat.tags) { const r = skips.get(base + t.start); if (r) skipped.set(t, r); }
    for (const t of beat.tags) if (t.action && !skipped.has(t)) acted.push(t.action);
    const added: El[] = [];
    for (const t of beat.tags) { const e = entries.get(base + t.start); if (e && t.action) added.push(toEl(e, t.action)); }
    const verdict = checkBeat({ beat, k, state, skipped, added, drawn, pageVals, consts, lines: env.lines, scene: namedScene(acted, pageWords) });
    drawn.push(...added);
    results.push({ k, opener, text: beat.text, tags: beat.tags.map((t) => t.action?.kind ?? '?malformed'), verdict, start: base + beat.start, end: base + beat.end });
  }
  return { label: `${rec.run}/${rec.q}`, question: rec.question, beats: results };
}
