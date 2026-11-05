// src/gate/live.ts — the live commit gate (design 2026-10-29 "Live commit gate"). It sits between
// the answer's raw stream and the AnswerSession: the stream is cut into units (opener chunks, then
// stage-2 sentences or beats), each unit is checked offscreen (Preflight: a re-parse with the
// session's own parser, the shadow board, checkBeat) before it is released, and only released text
// reaches the session. Invariants enforced here:
//   I1 once drawn is drawn: released text is never withdrawn or changed; a repair only replaces a unit
//      that was not released;
//   I2 no narration over a skipped action: a released unit contains no tag the preflight found
//      skipped or unparsable (the strip rule removes a failed page-pointing tag before release);
//   I3 words and ink together: a unit's words and tags are released as one piece, in stream order. On the
//      svg board a unit is one whole beat (src/svgboard/beat.ts): its group and its own sentences are
//      released together or withheld together, never a drawing without its words or the reverse. A
//      withheld beat leaves only what later beats build on (its board's opening, its definitions:
//      src/svgboard/defs.ts), so one withheld beat never cascades into the beats after it.
import { BeatSplitter, BEAT_DEFAULTS, NEW_INK, tokenize, units, type Beat, type Tag, type Word } from './segment';
import { MAX_TAG_CHARS, ScriptParser } from '../script/parser';
import { BEAT_TAG, hasBeatTags, isDefsGroup, isSvgTagBody, SVG_TAG_MAX, unescapeSvg, escapeSvg } from '../svgboard/wire';
import { definedNames, defsOf } from '../svgboard/defs';
import { GateState } from './engine';
import { checkBeat, namedScene, withSeverity, type Severity } from './verdict';
import { textNumbers } from './numbers';
import { numberFixes, type NumberFix } from './check';
import type { El, Rect } from './layout';
import type { Grounding } from '../geometry/resolve';
import type { RawAction } from '../script/types';
import { acceptGroups, checkGroups, newBoardState, type BoardState, type GroupGeo } from '../svgboard/check';
import type { NarrationClock } from '../playback/clock';
import { clauseAfter, deixisAt, isArticle, lookahead, markOf, replaceWord, sentenceTail, type Deixis } from '../script/quoteWords';
import { CHECK_WORDS, stepWords } from '../agent/pacing';
import { STEP_HOLD_MS } from '../playback/pace';
import type { FaultMode, Faults, GateFlag, GateLogEvent, GateMode, RepairFn, RepairReport, RepairResult } from './events';

/** Checked narration that must still be playing before the gate checks whole beats (and may repair). */
export const HEADROOM_MS = 6000;
/** Opus repairs take longer. */
export const HEADROOM_OPUS_MS = 9000;
/** A repair is asked only when the narration has this long left to play. */
export const MIN_REPAIR_MS = 2500;
/** How long past the narration's end the gate may hold the stage for a repair. */
export const MAX_HOLD_MS = 400;
export const MAX_REPAIRS = 2;
/** Dropping this share of an answer's words is logged loudly (console). */
export const LOUD_LOSS = 0.2;

// ------------------------------------------------------------------------------------------------
// Preflight: what checks one unit.

export type UnitKind = 'opener' | 'sentence' | 'beat';
export type PreflightUnit = { key: string; kind: UnitKind; text: string; fault?: FaultMode; /** The stream's end: no boundary is known after it. */ end?: boolean; /** A whole svg beat (a beat boundary before it). */ beat?: true };
/** A tag of the checked unit: offsets in the unit's text; `skipped` when the board (or the parser) would not draw it. */
export type PreflightTag = { start: number; end: number; body: string; action: RawAction | null; skipped?: string };
export type PreflightResult = { flags: GateFlag[]; notes: string[]; tags: PreflightTag[]; /** Spoken numbers the board's computed values contradict (check.ts numberFixes). */ fixes?: NumberFix[]; report?: () => Omit<RepairReport, 'later' | 'tail' | 'maxWords'> };

export interface Preflight {
  /** Checks a unit as if it were released after everything accepted so far. Must not change what is accepted. */
  check(u: PreflightUnit): Promise<PreflightResult> | PreflightResult;
  /** The unit (as checked last) was released: the shadow keeps it. */
  accept(u: PreflightUnit): void;
  /** The unit was not released: the shadow goes back to what was accepted. */
  reject(u: PreflightUnit): void;
}

/** What the shadow board says about a unit's actions. Headless (no board): nothing skipped. */
export interface ShadowBoard {
  /** Applies the unit's actions after the accepted ones; skip reasons by action. */
  apply(actions: RawAction[]): Promise<{ skipped: Map<RawAction, string>; added?: Map<RawAction, El[]> }> | { skipped: Map<RawAction, string>; added?: Map<RawAction, El[]> };
  /** Back to exactly the accepted actions (after a failed or unreleased check). */
  rebuild(accepted: RawAction[]): Promise<void> | void;
  /** Skips the board reported after their check returned (drained by the preflight into notes). */
  drift?: string[];
  /** The board's elements per section (the repair note's ON THE BOARD NOW). */
  scene?(): { section: string; items: { id: string; kind: string; label?: string }[] }[];
}

export type PreflightEnv = {
  board?: ShadowBoard;
  /** Page texts of the pages in play (numbers, page words for named references). */
  pages?: () => Map<number, string>;
  question?: string;
  grounding?: () => Grounding | undefined;
  /** A page's text lines in target space (annotations covering page text). */
  lines?: (page: number) => Rect[] | undefined;
  /** Which checks fail a unit (verdict.ts SEVERITY): `default`, or the design's (`&gatecheck=all`). */
  severity?: Severity;
  /** Offline: a recorded board's skip reason for a tag (by its body), standing in for the shadow board. */
  recorded?: (body: string) => string | undefined;
  /** The svg board's smallest text in section units (1000 across; the renderer raises smaller text to it); default 16. */
  svgMinFont?: () => number;
};

/** Kinds a strip may remove: pointing at the page, or an accent. */
const STRIPPABLE = (a: RawAction | null): boolean => {
  if (!a) return false;
  if (a.kind === 'emph') return true;
  const x = a as { page?: number; region?: string };
  if (a.kind === 'highlight' || a.kind === 'underline') return x.region == null;
  if (a.kind === 'circle' || a.kind === 'box') return x.page != null && x.region == null;
  return false;
};

const squash = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Page pointing the gate can vouch for without the shadow board: a scroll, or a highlight / underline /
 * circle / box on a page whose quote is in the page's text, whose mark is in the grounding, or which
 * gives coordinates. Anything else (or a quote not found) takes the full check.
 */
export function pagePointingOk(a: RawAction, pageText: (p: number) => string | undefined, g: Grounding | undefined): boolean {
  const x = a as { kind: string; page?: number; region?: string; quote?: string; mark?: string; at?: unknown };
  if (x.region != null) return false;
  if (a.kind === 'scroll') return (x.page ?? 0) >= 1;
  if (!['highlight', 'underline', 'circle', 'box'].includes(a.kind) || x.page == null) return false;
  if (x.mark) return !!g?.mark(x.page, x.mark.replace(/\.[ab]$/, ''));
  if (x.quote != null) { const t = pageText(x.page); const q = squash(x.quote); return !!t && q.length > 0 && squash(t).includes(q); }
  return x.at != null;
}

/**
 * The deictic the parser says at a page mark the sentence uses as a word (src/script/quoteWords.ts), read
 * from the narration around the tag the way the session's parser reads it: `prior` is the text released
 * before the unit. Null: none.
 */
function quoteSaid(prior: string, text: string, t: { start: number; end: number; action: RawAction | null }): Deixis | null {
  const m = markOf(t.action);
  if (!m) return null;
  const said = (prior.slice(-800) + text.slice(0, t.start)).replace(/\{\{[\s\S]*?\}\}/g, ' ').split(/\s+/).filter(Boolean);
  return deixisAt(sentenceTail(said), m, clauseAfter(text.slice(t.end), true, lookahead(m.quote)) ?? '');
}

/** One unit as a beat (all of its sentences). */
function beatOf(text: string, toks = tokenize(text)): Beat {
  const us = units(text, toks);
  const words = toks.filter((t): t is Word => t.kind === 'word');
  const tags = toks.filter((t): t is Tag => t.kind === 'tag');
  return { k: 0, units: us, words, tags, start: 0, end: text.length, text: us.map((u) => u.text).join(' ') };
}

/**
 * The gate's preflight: the session's parser over the accepted text plus the unit (what the live
 * session will see, {{val}} words included), the shadow board's skips, and checkBeat over the engine
 * state the accepted actions built.
 */
export class GatePreflight implements Preflight {
  private accepted = '';
  private acts: RawAction[] = [];
  /** Accepted beats' actions (non-skipped), per beat: the engine state is rebuilt from them. */
  private beats: RawAction[][] = [];
  private consts: { name: string; v: number; beat: number }[] = [];
  private drawn: El[] = [];
  private last: { u: PreflightUnit; acts: RawAction[]; added: El[]; consts: { name: string; v: number }[]; svg?: { board: BoardState; geos: GroupGeo[]; grow?: number } } | null = null;
  /** The svg board as accepted so far (its groups' text and strokes, ids, canvas). */
  private svg: BoardState | null = null;
  private dirty = false;
  constructor(private env: PreflightEnv = {}) {}

  /** Everything accepted so far (the released script). */
  text(): string { return this.accepted; }

  async check(u: PreflightUnit): Promise<PreflightResult> {
    const board = this.env.board;
    if (this.dirty && board) await board.rebuild(this.acts);
    this.dirty = false;
    // (1) The session's parser over the accepted text, then the unit tag by tag: a tag that yields no action is not parsed.
    const parser = new ScriptParser(new GateState(this.env.grounding?.()));
    const warn = console.warn;
    console.warn = () => {};
    const toks = tokenize(u.text, { end: !!u.end });
    const tagActs = new Map<Tag, RawAction[]>();
    try {
      parser.push(this.accepted);
      let pos = 0;
      for (const t of toks) {
        if (t.kind !== 'tag') continue;
        parser.push(u.text.slice(pos, t.start));
        // A tag the stream cut off (the last unit's end) is what the session's parser makes of it at its end.
        const cut = !!u.end && t.end === u.text.length && !u.text.endsWith('}}');
        const evs = cut ? [...parser.push(u.text.slice(t.start, t.end)), ...parser.end()] : parser.push(u.text.slice(t.start, t.end));
        tagActs.set(t, evs.flatMap((e) => (e.type === 'action' ? [e.action] : [])));
        pos = t.end;
      }
      parser.push(u.text.slice(pos));
    } finally { console.warn = warn; }
    const tags = toks.filter((t): t is Tag => t.kind === 'tag');
    const skipped = new Map<Tag, string>();
    for (const t of tags) {
      const as = tagActs.get(t) ?? [];
      // The parser's reading wins (it knows the constants): the beat checks what will play.
      const primary = as.find((a) => a.kind !== 'find') ?? as[0] ?? null;
      t.action = primary;
      if (!as.length) skipped.set(t, 'not parsed');
    }
    // (2) The shadow board. Opener and sentence units that only point at the page are vouched for from
    // the page's text and marks (first word: no waiting on a build against text runs still loading);
    // the shadow still applies them, off the critical path.
    const unitActs = tags.flatMap((t) => tagActs.get(t) ?? []);
    const pt = this.env.pages?.();
    const fast = !!board && u.kind !== 'beat' && !u.fault && unitActs.length > 0 && unitActs.every((a) => pagePointingOk(a, (p) => pt?.get(p), this.env.grounding?.()));
    let shadow: { skipped: Map<RawAction, string>; added?: Map<RawAction, El[]> };
    if (fast) { shadow = { skipped: new Map() }; void board!.apply(unitActs); }
    else shadow = board ? await board.apply(unitActs) : { skipped: new Map<RawAction, string>() };
    if (board && unitActs.length) this.dirty = true;
    for (const t of tags) for (const a of tagActs.get(t) ?? []) { const r = shadow.skipped.get(a); if (r && !skipped.has(t)) skipped.set(t, r); }
    // A section must be declared in this answer (the live desk frees ids at a new answer): a tag drawing
    // into a section no released or earlier tag of this unit opened is skipped, without asking the board.
    const regions = new Set(this.acts.filter((a) => a.kind === 'sketch').map((a) => (a as { id: string }).id));
    for (const t of tags) for (const a of tagActs.get(t) ?? []) {
      if (a.kind === 'sketch') { regions.add((a as { id: string }).id); continue; }
      const r = (a as { region?: string }).region;
      if (r != null && !regions.has(r) && !skipped.has(t)) skipped.set(t, 'unknown region');
    }
    if (this.env.recorded) for (const t of tags) { const r = this.env.recorded(t.body); if (r && !skipped.has(t)) skipped.set(t, r); }
    if (u.fault) {
      const t = tags.find((x) => x.action && NEW_INK.has(x.action.kind) && !skipped.has(x));
      if (t) skipped.set(t, 'injected');
    }
    // (3) Every check, over the engine state the accepted actions built.
    const state = new GateState(this.env.grounding?.());
    const pageText = this.env.pages?.() ?? new Map<number, string>();
    const pageVals: number[] = [];
    for (const [p, txt] of pageText) { const vs = textNumbers(txt); pageVals.push(...vs); state.addValues(vs, 'page', `p${p}`, -1); }
    if (this.env.question) state.addValues(textNumbers(this.env.question), 'question', 'question', -1);
    this.beats.forEach((as, k) => { for (const a of as) state.note(a); for (const a of as) { try { state.apply(a, k); } catch { /* the offline engine's gap: noted at check time */ } } });
    const k = this.beats.length;
    const redef0 = state.redefined.length;
    const beat = beatOf(u.text, toks);
    const unitConsts = tags.flatMap((t) => (t.action?.kind === 'const' && !skipped.has(t) ? t.action.defs.filter(([, v]) => /^[-−+]?\d*\.?\d+$/.test(v.trim())).map(([name, v]) => ({ name, v: Number(v.replace('−', '-')) })) : []));
    const added = tags.flatMap((t) => (skipped.has(t) ? [] : (tagActs.get(t) ?? []).flatMap((a) => shadow.added?.get(a) ?? [])));
    const kept = tags.flatMap((t) => (skipped.has(t) ? [] : tagActs.get(t) ?? []));
    const pageWords = new Set([...pageText.values()].flatMap((t) => t.split(/[^\p{L}\p{N}′']+/u)).filter(Boolean));
    const v0 = checkBeat({
      beat, k, state, skipped, added, drawn: this.drawn, pageVals,
      consts: [...this.consts, ...unitConsts.map((c) => ({ ...c, beat: k }))],
      lines: this.env.lines, scene: namedScene([...this.beats.flat(), ...kept], pageWords),
    });
    const fixes = numberFixes(beat.words, state.values, k);
    const v = withSeverity(v0, this.env.severity ?? 'default');
    if (board?.drift?.length) v.notes.push(...board.drift.splice(0));
    // The svg board: each group parses, its id is new, text clears text and strokes, it stays on the canvas.
    let svg: { board: BoardState; geos: GroupGeo[]; grow?: number } | undefined;
    {
      let sb = this.svg;
      const srcs: string[] = [];
      for (const t of tags) for (const a of tagActs.get(t) ?? []) {
        if (a.kind === 'sketch' && a.svgboard) sb = a.svgboard.extend && sb ? sb : newBoardState(a.svgboard.w, a.svgboard.h);
        if (a.kind === 'svg') srcs.push(a.svg);
      }
      if (srcs.length) {
        sb ??= newBoardState();
        // svgMinFont is per 1000 section units; a board's own units are its canvas width over the section's.
        const r = checkGroups(srcs, sb, ((this.env.svgMinFont?.() ?? 16) * sb.w) / 1000, state.svg);
        v.flags.push(...r.flags);
        v.notes.push(...r.notes);
        // A group that defines a constant already defined, to another value: the first stands on the board
        // (KitStore.defineConsts), so this group would draw (and its words say) a value it does not have.
        for (const d of new Set(state.redefined.slice(redef0))) v.flags.push({ check: 'svg', detail: `constant ${d} is already defined: give the new value a new name` });
        svg = { board: sb, geos: r.geos, ...(r.grow ? { grow: r.grow } : {}) };
      } else if (sb !== this.svg && sb) svg = { board: sb, geos: [] };
    }
    this.last = { u, acts: kept, added, consts: unitConsts, ...(svg ? { svg } : {}) };
    const scene = board?.scene?.();
    return {
      flags: v.flags.map((f) => ({ check: f.check, detail: f.detail })),
      notes: v.notes,
      tags: tags.map((t) => ({ start: t.start, end: t.end, body: t.body, action: t.action, ...(skipped.has(t) ? { skipped: skipped.get(t)! } : {}) })),
      ...(fixes.length ? { fixes } : {}),
      report: () => ({
        beat: u.text.trim(), problems: v.flags.map((f) => ({ check: f.check, detail: f.detail })),
        board: (scene ?? []).map((s) => ({ section: s.section, count: s.items.length, items: s.items })),
        consts: { ...state.consts }, finds: [...state.finds.keys()],
      }),
    };
  }

  accept(u: PreflightUnit): void {
    const l = this.last && this.last.u.text === u.text ? this.last : null;
    this.accepted += u.text;
    const k = this.beats.length;
    this.beats.push(l?.acts ?? []);
    this.acts.push(...(l?.acts ?? []));
    this.drawn.push(...(l?.added ?? []));
    this.consts.push(...(l?.consts ?? []).map((c) => ({ ...c, beat: k })));
    if (l?.svg) { acceptGroups(l.svg.board, l.svg.geos, l.svg.grow); this.svg = l.svg.board; }
    this.last = null;
    this.dirty = false;
  }

  reject(_u: PreflightUnit): void {
    this.last = null;
    if (this.env.board) { this.dirty = false; void this.env.board.rebuild(this.acts); }
  }
}

// ------------------------------------------------------------------------------------------------
// The gate.

export type LiveGateDeps = {
  clock: Pick<NarrationClock, 'now' | 'endsAt'>;
  preflight: Preflight;
  repair?: RepairFn;
  faults?: Faults;
  headroomMs?: number;
  maxHoldMs?: number;
  minRepairMs?: number;
  maxRepairs?: number;
  onEvent(e: GateLogEvent): void;
  /**
   * Runs the calc programs in a repair's text (src/calc/stream.ts `runCalcsIn`). The answer's own calcs run
   * before the gate reads the stream; a repair arrives here, downstream of that, so a <calc> it writes would
   * otherwise reach the board as source and its vals stay unbound.
   */
  calcs?(text: string): Promise<string>;
  /** Timers (tests: a fake clock's). */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
};

type Out = { push(s: string): void };

const realSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r) => {
  if (signal?.aborted) { r(); return; }
  const t = setTimeout(r, Math.max(0, ms));
  signal?.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
});

/** A small async queue. */
class Chan<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(x: T) { this.items.push(x); this.wake?.(); this.wake = null; }
  close() { this.closed = true; this.wake?.(); this.wake = null; }
  async *drain(): AsyncGenerator<T> {
    for (;;) {
      if (this.items.length) { yield this.items.shift()!; continue; }
      if (this.closed) return;
      await new Promise<void>((r) => { this.wake = r; });
    }
  }
}

const wordCount = (text: string) => tokenize(text).filter((t) => t.kind === 'word').length;
const leadWs = (s: string) => /^\s*/.exec(s)![0];

/** Unclosed tag at the end of `s` (the opener's text waits for its close). */
function openTag(s: string): boolean {
  const open = s.lastIndexOf('{{');
  if (open < 0) return false;
  const rest = s.slice(open);
  return !/\}\}/.test(rest) && !/[\n\r]/.test(rest) && rest.length < (isSvgTagBody(rest.slice(2, 8)) ? SVG_TAG_MAX : MAX_TAG_CHARS);
}

/** A unit's svg groups that draw (wire tags; a withheld beat's definitions draw nothing). */
const drawnGroups = (text: string): Tag[] => tokenize(text).filter((t): t is Tag => t.kind === 'tag' && isSvgTagBody(t.body.slice(0, 6)) && !isDefsGroup(t.body.replace(/^svg\s*/, '')));

/**
 * What a withheld unit leaves behind: the board it opens (`{{svgboard}}`: founder lec06, the board tag rode
 * in a dropped sentence and all five drawings were skipped), its constants (`{{const}}`) and its groups'
 * definitions (defs.ts). No words, no ink. Empty when it defined nothing.
 */
export function remnantOf(text: string, except: Set<string> = new Set(), constsOnly = false): string {
  const out: string[] = [];
  for (const t of tokenize(text, { end: true })) {
    if (t.kind !== 'tag') continue;
    if (/^\s*(?:svgboard|const)\b/.test(t.body)) { out.push(`{{${t.body}}}`); continue; }
    // A calc that ran is a definition too: the beats after it name its values (eval teach D4, 2026-11-05: the
    // beat carrying <calc id="img"> was dropped and every later beat failed on "data-slide: no calc img").
    if (/^\s*computed\b/.test(t.body) && !/\bfailed="/.test(t.body)) { out.push(`{{${t.body}}}`); continue; }
    if (!isSvgTagBody(t.body.slice(0, 6))) continue;
    const d = defsOf(unescapeSvg(t.body.replace(/^svg\s*/, '')), except, constsOnly);
    if (d) out.push(`{{svg ${escapeSvg(d)}}}`);
  }
  return out.length ? ` ${out.join(' ')} ` : '';
}

export class LiveGate {
  private stage2 = false;
  private openerBuf = '';
  private nOpener = 0;
  private nUnit = 0;
  private splitter = new BeatSplitter('sentence');
  private repairs = 0;
  private dropsInRow = 0;
  private cascade = false;
  private released2 = '';
  private releasedAll = '';
  private t0: number;
  private queue = new Chan<PreflightUnit>();
  reqId: string | null = null;
  /** Counters (?debug, replay). */
  readonly stats = { units: 0, fails: 0, strips: 0, drops: 0, droppedWords: 0, repairs: 0, repairOk: 0, released: 0, cuts: 0, cutWords: 0 };
  /** The answer's length budget (stage-2 words; src/agent/pacing.ts), from the scout's plan. */
  private budget: { capWords: number } | null = null;
  /** Stage-2 words released so far. */
  private words2 = 0;
  /** Past the budget at a beat boundary: units are held, and only the check question's beat plays at the end. */
  private closing = false;
  private held: PreflightUnit[] = [];

  constructor(private d: LiveGateDeps) { this.t0 = d.clock.now(); }

  private headroom() { return this.d.headroomMs ?? HEADROOM_MS; }
  private now() { return this.d.clock.now(); }
  private buffered() { return Math.max(0, this.d.clock.endsAt() - this.now()); }
  private sleep(ms: number, signal?: AbortSignal) { return (this.d.sleep ?? realSleep)(ms, signal); }

  /** Stage 2 starts: the opener's text so far is its last unit. */
  handoff(): void {
    if (this.stage2) return;
    const carry = this.openerBuf.trim() ? '' : this.openerBuf;
    if (carry) this.openerBuf = '';
    this.flushOpener(true);
    this.stage2 = true;
    this.splitter = new BeatSplitter(this.buffered() >= this.headroom() ? 'beat' : 'sentence');
    if (carry) this.enqueue(this.splitter.push(carry));
  }
  setReq(reqId: string): void { this.reqId = reqId; }
  /** The length budget (null: none). Set before stage 2 (the scout's verdict comes first). */
  setBudget(b: { capWords: number } | null): void { this.budget = b && b.capWords > 0 ? { capWords: b.capWords } : null; }
  /** Whether the answer was closed early by its budget. */
  closed(): boolean { return this.closing; }
  /**
   * Opus repairs take longer: more checked narration before repairs are allowed, and a repair is only
   * asked when the narration still to play outlasts it (Opus repairs took 8.7–11.7 s in answers.jsonl,
   * 2026-10-30): one asked with less room ran the narration dry and played "…" before its drop.
   */
  setHeadroom(ms: number): void { this.d.headroomMs = ms; this.d.minRepairMs = Math.max(this.d.minRepairMs ?? MIN_REPAIR_MS, ms + 1000); }
  /** Everything released so far (opener and stage 2): what the student heard and saw. */
  releasedText(): string { return this.releasedAll; }

  private flushOpener(force: boolean) {
    if (!this.openerBuf || (!force && openTag(this.openerBuf))) return;
    if (!this.openerBuf.trim()) return;
    const text = this.openerBuf;
    this.openerBuf = '';
    this.queue.push({ key: `o${this.nOpener++}`, kind: 'opener', text });
  }

  private enqueue(us: { text: string; kind: 'sentence' | 'beat'; beat?: true }[], end = false) {
    for (const u of us) this.queue.push({ key: String(this.nUnit++), kind: u.kind, text: u.text, ...(end ? { end } : {}), ...(u.beat ? { beat: true as const } : {}) });
  }

  /** A raw chunk arrived. */
  feed(c: string): void {
    if (!this.stage2) { this.openerBuf += c; this.flushOpener(false); return; }
    // Mode: whole beats once enough checked narration is queued; single sentences again below half of it.
    const b = this.buffered();
    if (this.splitter.mode === 'sentence' && b >= this.headroom()) this.enqueue(this.splitter.setMode('beat'));
    else if (this.splitter.mode === 'beat' && b < this.headroom() / 2) this.enqueue(this.splitter.setMode('sentence'));
    this.enqueue(this.splitter.push(c));
  }

  /** The stream ended (or was cut off): the rest is the last unit(s). */
  end(): void {
    if (!this.stage2) this.flushOpener(true);
    else this.enqueue(this.splitter.end(), true);
    this.queue.close();
  }

  /** The gated stream: released text only. */
  wrap(inner: (signal: AbortSignal) => AsyncIterable<string>): (signal: AbortSignal) => AsyncGenerator<string> {
    return (signal) => this.run(inner, signal);
  }

  private async *run(inner: (signal: AbortSignal) => AsyncIterable<string>, signal: AbortSignal): AsyncGenerator<string> {
    const out = new Chan<string>();
    let err: unknown = null;
    const pump = (async () => {
      try { for await (const c of inner(signal)) { if (signal.aborted) break; this.feed(c); } }
      catch (e) { err = e; }
      finally { this.end(); }
    })();
    const worker = (async () => {
      try {
        for await (const u0 of this.queue.drain()) { if (signal.aborted) break; for (const u of this.paced(u0)) { if (signal.aborted) break; await this.process(u, out, signal); } }
        if (!signal.aborted && this.held.length) {
          const { cut, keep } = this.closingBeat();
          // A cut beat's definitions go out ahead of the kept one, as a withheld beat's do: the check
          // question builds on them ("twice the constant" of a cut beat's k) and would fail without them.
          for (const u of cut) { if (signal.aborted) break; await this.remnant(u, out, signal, { board: !/\{\{svgboard\b/.test(this.releasedAll), note: 'cut by the budget: only its definitions go out' }); }
          for (const u of keep) { if (signal.aborted) break; await this.process(u, out, signal); }
        }
        // A gate that gutted an answer is a defect to see, not a quiet success: say so loudly.
        const kept = wordCount(this.released2), lost = this.stats.droppedWords;
        if (lost > 0 && lost >= LOUD_LOSS * (kept + lost)) {
          console.warn(`[gate] dropped ${lost} of ${kept + lost} words (${this.stats.drops} units) of answer ${this.reqId ?? ''}: see the gate events`);
        }
      }
      catch (e) { err ??= e; }
      finally { out.close(); }
    })();
    for await (const s of out.drain()) { if (signal.aborted) return; yield s; }
    await pump; await worker;
    if (err && !signal.aborted) throw err;
  }

  private emitGate(u: PreflightUnit, result: 'pass' | 'strip' | 'fail', action: 'release' | 'repair' | 'drop' | 'cut', r: PreflightResult | null, ms: number, extra: { stripped?: string[]; repaired?: boolean; notes?: string[]; text?: string } = {}) {
    const text = extra.text ?? u.text;
    this.d.onEvent({
      t: 'gate', k: u.key, unit: u.kind, result, action, flags: r?.flags ?? [], notes: [...(r?.notes ?? []), ...(extra.notes ?? [])],
      ms: Math.round(ms), bufferedMs: Math.round(this.buffered()), mode: (u.kind === 'beat' ? 'beat' : 'sentence') as GateMode,
      text: text.trim(), words: wordCount(text), ...(extra.stripped ? { stripped: extra.stripped } : {}), ...(extra.repaired ? { repaired: true } : {}),
      at: Math.round(this.now() - this.t0),
    });
  }

  private release(u: PreflightUnit, text: string, out: Out) {
    this.d.preflight.accept({ ...u, text });
    const sent = this.bounded(u, text);
    if (u.kind !== 'opener') { this.released2 += sent; this.words2 += wordCount(sent) + stepWords(sent, STEP_HOLD_MS); }
    this.releasedAll += sent;
    this.stats.released++;
    this.dropsInRow = 0;
    out.push(sent);
  }

  /**
   * A closed unit ends on a word that the stream follows with whitespace: a stage-2 unit closes only
   * once its last word is followed by whitespace (BeatSplitter), and an opener piece without trailing
   * whitespace is the opener's last (OpenerGate cuts after the space; only its end() has none). The
   * session's parser emits a word once it sees what follows, so released without that boundary the
   * unit's last word would wait for the next unit to be checked and released (the seam holds of draw
   * run 5b74be89: 2.3 s). The boundary goes out with the unit; the next unit's leading space, which
   * is that same boundary in the stream, is dropped once. Only whitespace moves: words and tags are
   * released exactly as checked (I1–I3).
   */
  private owedSpace = false;
  private bounded(u: PreflightUnit, text: string): string {
    let t = text;
    if (this.owedSpace && t.startsWith(' ')) t = t.slice(1);
    if (t) this.owedSpace = false;
    const closed = u.end ? false : u.kind === 'opener' ? /[.!?,;:…]["'’”)\]]*$/.test(t) : true;
    if (closed && t.trim() && !/\s$/.test(t)) { t += ' '; this.owedSpace = true; }
    return t;
  }


  /**
   * Whether a beat boundary lies just before stage-2 unit `u` (`prev`: the text just before it). A whole
   * svg beat always opens one (src/svgboard/beat.ts). Otherwise (the opener's sentences; a stream with no
   * `{{beat}}`, where a group rides with the sentence before it): `u` starts with words (a page-pointing
   * tag may lead) and the text before it ends a sentence or a group.
   */
  private opensBeat(u: PreflightUnit, prev: string): boolean {
    if (u.beat) return true;
    const toks = tokenize(u.text);
    const first = toks.findIndex((t) => t.kind === 'word');
    if (first < 0 || toks.slice(0, first).some((t) => t.kind === 'tag' && isSvgTagBody(t.body.slice(0, 6)))) return false;
    return /[.!?…]["'’”)\]]*$|\}\}$/.test(prev.trimEnd());
  }

  /**
   * The length budget: once the released stage-2 words leave no room for more than the check question,
   * the answer closes at the next beat boundary. Everything after it is held; at the stream's end only
   * the check question's beat is checked and played (closingBeat). A beat is never cut inside: the
   * splitter hands whole svg beats. Returns the units to check now (none when held).
   */
  private paced(u: PreflightUnit): PreflightUnit[] {
    if (u.kind === 'opener' || !this.budget || !this.stage2) return [u];
    if (this.closing) { this.held.push(u); return []; }
    const room = this.budget.capWords - CHECK_WORDS;
    if (this.words2 >= room && this.opensBeat(u, this.released2)) { this.closing = true; this.held.push(u); return []; }
    return [u];
  }

  /** The held units' last beat that asks the student a question (`keep`, played); the rest are cut (`cut`: those before it, whose definitions it may use). */
  private closingBeat(): { cut: PreflightUnit[]; keep: PreflightUnit[] } {
    const h = this.held;
    this.held = [];
    const starts = h.flatMap((u, i) => (i === 0 || this.opensBeat(u, h[i - 1].text) ? [i] : []));
    const asks = (us: PreflightUnit[]) => /\?/.test(us.map((u) => u.text.replace(/\{\{[^}]*\}\}/g, ' ')).join(' '));
    let keep: [number, number] | null = null;
    for (let j = starts.length - 1; j >= 0 && !keep; j--) {
      const a = starts[j], b = j + 1 < starts.length ? starts[j + 1] : h.length;
      if (asks(h.slice(a, b))) keep = [a, b];
    }
    const out: PreflightUnit[] = [], cut: PreflightUnit[] = [];
    h.forEach((u, i) => {
      if (keep && i >= keep[0] && i < keep[1]) { out.push({ ...u, ...(i === keep[1] - 1 ? { end: true } : {}) }); return; }
      this.stats.cuts++;
      this.stats.cutWords += wordCount(u.text);
      this.emitGate(u, 'pass', 'cut', null, 0, { notes: ['budget: past the answer\'s length, closed at a beat boundary'] });
      if (keep && i < keep[0]) cut.push(u);
    });
    return { cut, keep: out };
  }

  /** Withholds `u` whole (words and drawing); what later beats build on still goes out (remnant). */
  private async drop(u: PreflightUnit, r: PreflightResult | null, ms: number, notes: string[], out: Out, signal: AbortSignal) {
    this.d.preflight.reject(u);
    this.stats.drops++;
    this.stats.droppedWords += wordCount(u.text);
    if (u.kind === 'beat' && ++this.dropsInRow >= 2 && !this.cascade) { this.cascade = true; notes = [...notes, 'cascade: two drops in a row, no more repairs']; }
    this.emitGate(u, 'fail', 'drop', r, ms, { notes });
    await this.remnant(u, out, signal);
  }

  /**
   * Releases what withheld unit `u` defined (remnantOf: its board's opening, constants, definitions), in
   * its place in the stream, so the beats after it resolve what they build on, on the board and in the
   * gate's state alike. Checked like any unit; a definition that conflicts with one already out (a repair
   * that defined it again differently) is not sent.
   */
  private async remnant(u: PreflightUnit, out: Out, signal: AbortSignal, o: { board?: boolean; after?: string; note?: string } = {}) {
    // After a repair: only what the repair did not define itself (its own frame or curve stands).
    const except = new Set(o.after ? drawnGroups(o.after).flatMap((t) => [...definedNames(unescapeSvg(t.body.replace(/^svg\s*/, '')))]) : []);
    // The definitions that broke the beat (a curve with no value, a frame that does not resolve) break
    // its remnant too; then its constants alone go out, which later beats need most (eval D19, 2026-11-01:
    // the remnant was refused whole and the two beats after it failed on "unknown constant").
    let ru: PreflightUnit | null = null, r: PreflightResult | null = null, text = '';
    for (const constsOnly of [false, true]) {
      const t = remnantOf(u.text, except, constsOnly);
      text = o.board === false ? t.replace(/\{\{svgboard\b[^}]*\}\}\s*/g, '') : t;
      if (!text.trim()) return;
      ru = { key: `${u.key}d${constsOnly ? 'c' : ''}`, kind: u.kind, text, ...(u.end ? { end: true } : {}) };
      r = await this.d.preflight.check(ru);
      if (signal.aborted) return;
      if (!r.flags.length) break;
      this.d.preflight.reject(ru);
      r = null;
    }
    if (!r || !ru) return;
    this.emitGate(ru, 'strip', 'release', r, 0, { stripped: ['its words', 'its drawing'], notes: [o.note ?? 'withheld whole: only its board and definitions go out'] });
    this.release(ru, text, out);
  }

  private async process(u0: PreflightUnit, out: Out, signal: AbortSignal): Promise<void> {
    const fault = this.d.faults?.get(u0.key);
    let u: PreflightUnit = fault ? { ...u0, fault } : u0;
    this.stats.units++;
    const t0 = this.now();
    let r = await this.d.preflight.check(u);
    if (signal.aborted) return;
    // A number said that the board computes differently is said as the board's (the unit is not
    // released yet, so I1 holds): what is heard matches what is drawn.
    if (r.fixes?.length) {
      let text = u.text;
      for (const f of [...r.fixes].sort((a, b) => b.start - a.start)) text = text.slice(0, f.start) + f.to + text.slice(f.end);
      const note = `numbers said as the board's: ${r.fixes.map((f) => `${f.from} → ${f.to} (${f.of})`).join(', ')}`;
      console.warn(`[gate] ${note}`);
      this.d.preflight.reject(u);
      u = { ...u, text };
      const r2 = await this.d.preflight.check(u);
      if (signal.aborted) return;
      r = { ...r2, notes: [...r2.notes, note] };
    }
    const ms = this.now() - t0;
    if (!r.flags.length) { this.emitGate(u, 'pass', 'release', r, ms); this.release(u, u.text, out); return; }
    this.stats.fails++;
    // Strip: a failed page-pointing tag (or accent) leaves; the unit plays without it if it then passes.
    const strip = this.stripOf(u, r);
    if (strip) {
      this.d.preflight.reject(u);
      const su: PreflightUnit = { key: u.key, kind: u.kind, text: strip.text, ...(u.end ? { end: true } : {}) };
      const r2 = await this.d.preflight.check(su);
      if (signal.aborted) return;
      if (!r2.flags.length) {
        this.stats.strips++;
        this.emitGate(u, 'strip', 'release', r, this.now() - t0, { stripped: strip.removed, text: strip.text });
        this.release(su, strip.text, out);
        return;
      }
      this.d.preflight.reject(su);
    }
    // Repair: whole beats in stage 2 (not the first unit), while the narration has room to spare.
    const repair = this.repairFn(u);
    const dry = this.d.clock.endsAt();
    const room = dry - this.now();
    if (repair && u.kind === 'beat' && u.key !== '0' && !this.cascade && this.repairs < (this.d.maxRepairs ?? MAX_REPAIRS) && room >= (this.d.minRepairMs ?? MIN_REPAIR_MS)) {
      this.emitGate(u, 'fail', 'repair', r, ms);
      this.d.preflight.reject(u);
      await this.doRepair(u, r, repair, dry, out, signal);
      return;
    }
    await this.drop(u, r, ms, [], out, signal);
  }

  /** The unit with its strippable failed tags removed, when that is all that failed. */
  private stripOf(u: PreflightUnit, r: PreflightResult): { text: string; removed: string[] } | null {
    const bad = r.tags.filter((t) => t.skipped);
    if (!bad.length || !bad.every((t) => STRIPPABLE(t.action))) return null;
    // Only the tags' own flags (and the deixis they leave) may fail; anything else is not the tag's fault.
    if (r.flags.some((f) => f.check !== 'tag' && f.check !== 'deixis')) return null;
    const later = [...this.splitter.pending().matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]).join(' ');
    for (const t of bad) {
      const id = (t.action as { id?: string } | null)?.id;
      if (id && new RegExp(`(^|[^\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`).test(later)) return null;
    }
    let text = u.text;
    for (const t of [...bad].sort((a, b) => b.start - a.start)) {
      // A mark the sentence used as a word leaves the deictic the parser would have said at it: "The
      // {{highlight p=8 "…"}} uses…" stripped is "This uses…", never "The uses…" nor the page's words.
      const d = quoteSaid(this.releasedAll, u.text, t);
      let before = text.slice(0, t.start);
      const after = text.slice(t.end);
      let say = d?.words ?? '';
      if (d?.replacesPrev) {
        const w = /(\S+)(\s*)$/.exec(before);
        if (w && isArticle(w[1])) { before = before.slice(0, w.index) + replaceWord(w[1], say) + w[2]; say = ''; }
      }
      if (say) text = before + (before && !/\s$/.test(before) ? ' ' : '') + say + (/^[\p{L}\p{N}]/u.test(after) ? ' ' : '') + after;
      else text = /\s$/.test(before) && /^\s/.test(after) ? before + after.replace(/^[ \t]+/, '') : before + after;
    }
    return { text, removed: bad.map((t) => `{{${t.body}}}`) };
  }

  private repairFn(u: PreflightUnit): RepairFn | null {
    const f = u.fault;
    if (f === 'late' || f === 'bad' || f === 'ok') {
      return async (req, sig) => {
        if (f === 'late') await this.sleep(req.deadlineMs + 500, sig);
        if (f === 'ok') {
          // A fake fix: the point said plainly, with no tags (and so no pointing at them).
          const text = req.beat.replace(/\{\{[^}]*\}\}/g, '').replace(/\b(notice|look at)\b\s*/gi, '').replace(/[ \t]{2,}/g, ' ');
          return { ok: true, text };
        }
        return { ok: true, text: req.beat };
      };
    }
    return this.d.repair ?? null;
  }

  private async doRepair(u: PreflightUnit, r: PreflightResult, fn: RepairFn, dry: number, out: Out, signal: AbortSignal): Promise<void> {
    this.repairs++;
    this.stats.repairs++;
    const t0 = this.now();
    const deadline = dry + (this.d.maxHoldMs ?? MAX_HOLD_MS);
    const ws = tokenize(this.released2).filter((t): t is Word => t.kind === 'word');
    const n = wordCount(u.text);
    const base = r.report?.() ?? { beat: u.text.trim(), problems: r.flags, board: [], consts: {}, finds: [] };
    const report: RepairReport = { ...base, later: this.laterIds(), tail: ws.slice(-12).map((w) => w.text).join(' '), maxWords: n + 10 };
    this.d.onEvent({ t: 'repair', k: u.key, phase: 'sent', ms: 0 });
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = new AbortController();
    const late = this.sleep(deadline - this.now(), timer.signal).then(() => 'late' as const);
    let res: RepairResult | 'late';
    try {
      res = await Promise.race([fn({ k: Number(u.key), committed: this.released2, beat: u.text.trim(), report, deadlineMs: Math.max(0, Math.round(deadline - this.now())) }, ac.signal).catch((e) => ({ ok: false as const, reason: 'error' as const, detail: String(e) })), late]);
    } finally { timer.abort(); signal.removeEventListener('abort', onAbort); }
    if (signal.aborted) return;
    const ms = this.now() - t0;
    if (res === 'late') { ac.abort(); this.d.onEvent({ t: 'repair', k: u.key, phase: 'late', ms: Math.round(ms) }); await this.drop(u, r, ms, ['repair late'], out, signal); return; }
    if (!res.ok) { this.d.onEvent({ t: 'repair', k: u.key, phase: res.reason, ms: Math.round(ms), ...(res.usd != null ? { usd: res.usd } : {}) }); await this.drop(u, r, ms, [`repair ${res.reason}${res.detail ? `: ${res.detail}` : ''}`], out, signal); return; }
    // A repair replaces a beat of the board already open: it never opens a board of its own (a BOARD
    // tag here would open a second section, and the beat's group would land below the first figure,
    // out of the frame its coordinates are in). Only a unit that opened the board keeps its tag.
    const opened = /\{\{svgboard\b[^}]*\}\}/.exec(u.text);
    let text = opened ? res.text : res.text.replace(/\{\{svgboard\b[^}]*\}\}\s*/g, '');
    if (this.d.calcs && /<calc[\s>]|\{\{calcsrc/.test(text)) { text = await this.d.calcs(text); if (signal.aborted) return; }
    // The unit that opened the board keeps its own BOARD tag even when the repair wrote none (founder lec06
    // 2026-10-31, turn 3: the first beat failed, its repair came back without {{svgboard}}, and every group
    // of the answer was then skipped, "unknown region": the board had never opened).
    if (opened && !/\{\{svgboard\b/.test(text)) text = `${opened[0]} ${text.trimStart()}`;
    // A whole beat keeps its boundary: a repair written words-first (trailing order) carries no leading
    // {{beat}} (the filter owes it to the next word, and none follows), and without one the repaired beat
    // would join the beat before it: its group anchored and paced on that beat's words.
    if (u.beat && !hasBeatTags(text)) text = opened ? text.replace(opened[0], `${opened[0]} ${BEAT_TAG}`) : `${BEAT_TAG} ${text.trimStart()}`;
    if (!/^\s/.test(text)) text = (leadWs(u.text) || ' ') + text;
    this.d.onEvent({ t: 'repair', k: u.key, phase: 'ok', ms: Math.round(ms), text: res.text, ...(res.usd != null ? { usd: res.usd } : {}) });
    // `&gatefail=K:bad`: the original comes back and its injected skip with it.
    const ru: PreflightUnit = { key: u.key, kind: u.kind, text, ...(u.end ? { end: true } : {}), ...(u.fault === 'bad' ? { fault: 'skip' as const } : {}) };
    const t1 = this.now();
    const r2 = await this.d.preflight.check(ru);
    if (signal.aborted) return;
    // A beat that drew keeps drawing: a repair that comes back as words alone would say what is not drawn (a5, a32).
    const lost = drawnGroups(u.text).length > 0 && !drawnGroups(text).length;
    if (!r2.flags.length && text.trim() && !lost) {
      this.stats.repairOk++;
      this.emitGate(ru, 'pass', 'release', r2, this.now() - t1, { repaired: true });
      this.release(ru, text, out);
      // What the original defined and the repair did not: the beats after it may build on it.
      await this.remnant(u, out, signal, { board: false, after: text });
      return;
    }
    this.d.onEvent({ t: 'repair', k: u.key, phase: 'fail', ms: Math.round(this.now() - t0) });
    this.d.preflight.reject(ru);
    this.stats.drops++;
    this.stats.droppedWords += wordCount(u.text);
    if (++this.dropsInRow >= 2 && !this.cascade) this.cascade = true;
    this.emitGate(ru, 'fail', 'drop', r2, this.now() - t1, { repaired: true, notes: [lost ? 'the repair left out the beat\'s drawing' : 'the repair failed its re-check'] });
    await this.remnant(u, out, signal);
  }

  /** Ids the buffered (unreleased) text names that no released tag creates. */
  private laterIds(): string[] {
    const made = new Set<string>();
    for (const t of tokenize(this.released2)) if (t.kind === 'tag') { const id = (t.action as { id?: string } | null)?.id; if (id) made.add(id); }
    const out = new Set<string>();
    for (const t of tokenize(this.splitter.pending())) {
      if (t.kind !== 'tag') continue;
      for (const m of t.body.matchAll(/\b(?:ref|on|of|axes|right|below|from|to|id)=([A-Za-z_][\w]*)/g)) if (!made.has(m[1]) && m[0].slice(0, 3) !== 'id=') out.add(m[1]);
    }
    return [...out];
  }
}

export { BEAT_DEFAULTS };
