// src/agent/context/memory.ts — session memory (spec "Interaction model": Ask = a new answer or a
// follow-up that knows the previous answer's plan and board).
//
// Each completed answer leaves a compact record: the question, the pages it taught from, how it
// related to the answer before it, the plan (the scout's lesson design, and the storyboard's when
// there was one), the board as data (each section, each drawn thing's id, kind, label and the words
// it was drawn on, the constants and values it was built from), the claims it made and the check
// question it ended on. The MEMORY block lists these, oldest first. It is append-only: an entry is
// written once and never changes, so turn N+1's block starts with turn N's and a cache breakpoint at
// its end reads the earlier turns from cache. Past FULL_TURNS entries the oldest half is rolled into
// one short line each (the only time the block's prefix changes).
import { svgTextWords } from '../../svgboard/check';
import type { Storyboard } from '../storyboard';

/** How a question stands to the answer before it (the scout decides; see server/prompt/scout.ts). */
export const RELATIONS = ['continue', 'revise-representation', 'simplify', 'new-example', 'deeper', 'new-topic'] as const;
export type Relation = (typeof RELATIONS)[number];
export const isRelation = (v: unknown): v is Relation => typeof v === 'string' && (RELATIONS as readonly string[]).includes(v);
/** Relations that ask for the same idea again in another way: a fresh scene, a different representation or level. */
export const REVISIONS: ReadonlySet<Relation> = new Set(['revise-representation', 'simplify', 'new-example', 'deeper']);

/** One thing the answer drew on the board. */
export type BoardThing = { id?: string; kind: string; on?: string; label?: string;
  /** Data it was built from (fn=, vals=, of=, op=, pts=, x=/y=): the values the student saw. */
  data?: string;
  /** The narration it was drawn on: what it stood for. */
  means?: string };
export type BoardSection = { id: string; kind: 'scene' | 'sketch' | 'svgboard'; near?: string };
export type TurnRecord = {
  question: string;
  /** The page the student was on. */
  page: number;
  /** The pages it taught from, in order. */
  pages: number[];
  relation?: Relation;
  /** The lesson design: the scout's plan, and the storyboard's example and scene when there was one. */
  plan: string;
  sections: BoardSection[];
  things: BoardThing[];
  /** `{{const}}` names and values, in order. */
  constants: string[];
  /** Later changes to drawn things (set, move, contrast…), in order. */
  changes: string[];
  claims: string[];
  check?: string;
  /** The student stopped it part-way. */
  stopped?: boolean;
  /** The svg board: its BOARD layout from the answer's plan (canvas, regions, groups), for a follow-up that extends it. */
  layout?: string;
  /**
   * The answer's own accounting, from its hidden plan's "parts:" line (p6.6): the parts the question asked
   * for, which this answer covered and which it left, so a follow-up that says "not complete" or "not
   * good enough" knows what is still owed.
   */
  parts?: string;
};

export const FULL_TURNS = 8;
const LAYOUT_CHARS = 500;
const Q_CHARS = 300, PARTS_CHARS = 400, PLAN_CHARS = 600, CLAIM_CHARS = 170, MEANS_WORDS = 9, MAX_THINGS = 24, MAX_CLAIMS = 8;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => { const t = squash(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Each `{{…}}` tag with its span (quoted text may hold braces). */
export function tagsOf(raw: string): { start: number; end: number; inner: string }[] {
  const out: { start: number; end: number; inner: string }[] = [];
  let i = 0;
  while ((i = raw.indexOf('{{', i)) >= 0) {
    let j = i + 2, q = false, close = -1;
    for (; j < raw.length; j++) {
      const c = raw[j];
      if (c === '"') q = !q;
      else if (!q && c === '}' && raw[j + 1] === '}') { close = j; break; }
      else if (!q && c === '{' && raw[j + 1] === '{') break;
    }
    if (close < 0) { i += 2; continue; }
    out.push({ start: i, end: close + 2, inner: raw.slice(i + 2, close) });
    i = close + 2;
  }
  return out;
}

type Tag = { kind: string; args: Record<string, string>; quotes: string[]; flags: string[] };
/** `kind key=value "quoted" flag …` (values may be quoted). */
export function readTag(inner: string): Tag {
  const s = inner.trim();
  const kind = (/^[a-z]+/i.exec(s)?.[0] ?? '').toLowerCase();
  const args: Record<string, string> = {}, quotes: string[] = [], flags: string[] = [];
  for (const m of s.slice(kind.length).matchAll(/([\w.]+)=("([^"]*)"|\S+)|"([^"]*)"|(\S+)/g)) {
    if (m[1]) args[m[1]] = m[3] ?? m[2];
    else if (m[4] != null) quotes.push(m[4]);
    else if (m[5]) flags.push(m[5]);
  }
  return { kind, args, quotes, flags };
}

/** Narration only: tags and the private <plan> removed, whitespace squashed per paragraph. */
export function narrationOf(script: string): string {
  let out = '', at = 0;
  for (const t of tagsOf(script)) { out += script.slice(at, t.start); at = t.end; }
  out += script.slice(at);
  return out.replace(/<plan>[\s\S]*?(<\/plan>|$)/g, ' ').split(/\n\s*\n/).map(squash).filter(Boolean).join('\n\n');
}

const sentences = (p: string) => p.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g)?.map(squash).filter(Boolean) ?? [];

/** Page-only actions (they mark the slides, not the board). */
const PAGE_ONLY = new Set(['scroll', 'highlight', 'underline']);
/** Verbs that change or point at something already drawn. */
const VERBS = new Set(['set', 'move', 'emph', 'fade', 'step', 'sweep', 'col', 'split', 'contrast', 'limit', 'beforeafter', 'band', 'dist', 'level']);
const DATA_KEYS = ['fn', 'vals', 'of', 'op', 'pts', 'x', 'y', 'map', 'zip', 'over', 'size', 'domain', 'value', 'strength', 'cols', 'labels', 'reduce'];

/** The board an answer's script left, as data. */
export function boardOf(script: string): Pick<TurnRecord, 'sections' | 'things' | 'constants' | 'changes'> {
  const sections: BoardSection[] = [], things: BoardThing[] = [], constants: string[] = [], changes: string[] = [];
  for (const t of tagsOf(script)) {
    // The svg board: its section, and each group by id with the words written in it.
    if (/^\s*svg\s*</.test(t.inner)) {
      const id = /^\s*svg\s*<g\b[^>]*?\bid="([^"]+)"/.exec(t.inner)?.[1];
      const words = svgTextWords(t.inner).join(' ');
      const after = sentences(narrationOf(script.slice(Math.max(0, t.start - 300), t.start))).slice(-1)[0] ?? '';
      if (things.length < MAX_THINGS) things.push({ kind: 'svg group', ...(id ? { id } : {}), ...(words ? { label: clip(words, 60) } : {}), ...(after ? { means: clip(after.split(' ').slice(0, MEANS_WORDS).join(' '), 80) } : {}) });
      continue;
    }
    const g = readTag(t.inner);
    if (g.kind === 'svgboard') { sections.push({ id: 'board', kind: 'svgboard' }); continue; }
    if (!g.kind || PAGE_ONLY.has(g.kind) || g.kind === 'let') continue;
    if ((g.kind === 'scene' || g.kind === 'sketch') && g.args.id) { sections.push({ id: g.args.id, kind: g.kind, ...(g.args.near ? { near: g.args.near } : {}) }); continue; }
    if (g.kind === 'const') { for (const [k, v] of Object.entries(g.args)) constants.push(`${k}=${v}`); continue; }
    if (VERBS.has(g.kind)) {
      if (['set', 'move', 'split', 'contrast', 'limit', 'beforeafter', 'col'].includes(g.kind)) {
        const what = g.args.id ?? g.args.of ?? '';
        const rest = Object.entries(g.args).filter(([k]) => k !== 'id' && k !== 'of' && k !== 'on' && k !== 'dur').map(([k, v]) => `${k}=${v}`);
        changes.push(clip(`${g.kind} ${what}${rest.length ? ` ${rest.join(' ')}` : ''}${g.quotes.length ? ` "${g.quotes.join('" "')}"` : ''}`, 120));
      }
      continue;
    }
    // A page mark ({{circle p=4 …}}) is pointing, not board.
    if (g.args.p && !g.args.on) continue;
    if (!g.args.on && !g.args.id) continue;
    if (things.length >= MAX_THINGS) continue;
    const data = DATA_KEYS.filter((k) => g.args[k] != null).map((k) => `${k}=${g.args[k]}`).join(' ');
    const after = sentences(narrationOf(script.slice(t.end, t.end + 400)))[0] ?? '';
    const means = after.split(' ').slice(0, MEANS_WORDS).join(' ');
    things.push({
      kind: g.kind, ...(g.args.id ? { id: g.args.id } : {}), ...(g.args.on ? { on: g.args.on } : {}),
      ...(g.quotes[0] ? { label: clip(g.quotes.join(' / '), 60) } : {}), ...(data ? { data: clip(data, 120) } : {}),
      ...(means ? { means: clip(means, 80) } : {}),
    });
  }
  return { sections, things, constants, changes };
}

/** The claims an answer made (one per beat: each paragraph's first sentence; a single paragraph: its sentences) and its closing question. */
export function claimsOf(script: string): { claims: string[]; check?: string } {
  const paras = narrationOf(script).split('\n\n').filter(Boolean);
  const all = paras.flatMap(sentences);
  const last = all[all.length - 1];
  const check = last?.endsWith('?') ? clip(last, CLAIM_CHARS) : undefined;
  const pool = (paras.length > 2 ? paras.map((p) => sentences(p)[0] ?? '') : all).filter((s) => s && !s.endsWith('?'));
  // Evenly spread when there are more than fit.
  const pick = pool.length <= MAX_CLAIMS ? pool : Array.from({ length: MAX_CLAIMS }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (MAX_CLAIMS - 1))]);
  return { claims: pick.map((s) => clip(s, CLAIM_CHARS)), ...(check ? { check } : {}) };
}

/** The plan as the lesson was designed: the scout's plan, then the storyboard's example and scene. */
export function planOf(plan: string, story?: Storyboard): string {
  const parts = [squash(plan)];
  if (story) parts.push(`example: ${squash(story.example)}`, `scene: ${squash(story.scene.things)}`);
  return clip(parts.filter(Boolean).join(' | '), PLAN_CHARS);
}

/** The svg board's layout from an answer's own <plan>: from its BOARD line on (canvas, regions, groups). */
export function layoutOf(plan: string): string | undefined {
  const i = plan.search(/\bBOARD\b/);
  return i < 0 ? undefined : clip(squash(plan.slice(i)), LAYOUT_CHARS);
}

/** The answer's accounting of the question's parts from its own plan: the line that starts "parts:" (p6.6), or undefined. */
export function partsOf(plan: string): string | undefined {
  const m = /^[ \t]*parts\s*:\s*(.+)$/im.exec(plan);
  const t = m ? squash(m[1]) : '';
  return t ? clip(t, PARTS_CHARS) : undefined;
}

/** A finished answer → its record. */
export function recordOf(t: { question: string; page: number; pages: number[]; plan: string; script: string; relation?: Relation; storyboard?: Storyboard; stopped?: boolean; answerPlan?: string }): TurnRecord {
  const layout = layoutOf(t.answerPlan ?? '');
  const parts = partsOf(t.answerPlan ?? '');
  return {
    ...(layout ? { layout } : {}),
    ...(parts ? { parts } : {}),
    question: t.question, page: t.page, pages: [...new Set([t.page, ...t.pages])],
    ...(t.relation ? { relation: t.relation } : {}),
    plan: planOf(t.plan, t.storyboard), ...boardOf(t.script), ...claimsOf(t.script),
    ...(t.stopped ? { stopped: true } : {}),
  };
}

const thingLine = (x: BoardThing) => `${x.kind}${x.id ? ` ${x.id}` : ''}${x.label ? ` "${x.label}"` : ''}${x.data ? ` [${x.data}]` : ''}${x.means ? ` (said: ${x.means})` : ''}`;

/**
 * One answer as MEMORY lines. `root`: the answer that opened the thread this one continues or revises (the
 * question the student is still on: a follow-up that says the answer was not good enough or not complete
 * is about that question in full, wherever the student has scrolled to since).
 */
export function entryText(n: number, r: TurnRecord, root?: number): string {
  const follows = r.relation && r.relation !== 'new-topic' && n > 1;
  const rel = follows ? `; ${r.relation} of A${n - 1}${root && root < n - 1 ? `; still on A${root}'s question` : ''}` : '';
  const lines = [`A${n} (on p${r.page}${rel}${r.stopped ? '; stopped part-way by the student' : ''}) "${clip(r.question, Q_CHARS)}" → taught ${r.pages.map((p) => `p${p}`).join(' ')}`];
  if (r.plan) lines.push(`  plan: ${r.plan}`);
  if (r.parts) lines.push(`  parts: ${r.parts}`);
  if (r.sections.length || r.things.length) {
    const secs = r.sections.map((s) => `${s.kind} ${s.id}${s.near ? ` near ${s.near}` : ''}`).join(', ');
    lines.push(`  board${secs ? ` (${secs})` : ''}: ${r.things.length ? r.things.map(thingLine).join('; ') : 'nothing drawn'}`);
  } else lines.push('  board: nothing drawn');
  if (r.layout) lines.push(`  board layout: ${r.layout}`);
  if (r.constants.length) lines.push(`  constants: ${r.constants.join(' ')}`);
  if (r.changes.length) lines.push(`  changed: ${r.changes.join('; ')}`);
  if (r.claims.length) lines.push(`  said: ${r.claims.join(' | ')}`);
  if (r.check) lines.push(`  asked: ${r.check}`);
  return lines.join('\n');
}

/** An older answer rolled into one line: its question, pages and what it drew. */
export function rolledText(n: number, r: TurnRecord): string {
  const kinds = [...new Set(r.things.map((x) => x.kind))].slice(0, 6).join(', ');
  return `A${n} (p${r.page}) "${clip(r.question, 80)}" → ${r.pages.map((p) => `p${p}`).join(' ')}${kinds ? `; drew ${kinds}` : ''}`;
}

export class SessionMemory {
  private records: TurnRecord[] = [];
  /** Entries already written, in order (text never changes once written, until a roll). */
  private entries: string[] = [];
  private rolled: string[] = [];
  /** Per answer, the answer that opened its thread (itself for a new topic). */
  private roots: number[] = [];

  add(r: TurnRecord): void {
    this.records.push(r);
    const n = this.records.length;
    const root = r.relation && r.relation !== 'new-topic' && n > 1 ? this.roots[n - 2] : n;
    this.roots.push(root);
    this.entries.push(entryText(n, r, root));
    if (this.entries.length > FULL_TURNS) {
      const k = FULL_TURNS / 2;
      const first = this.records.length - this.entries.length + 1;
      this.rolled.push(...this.entries.splice(0, k).map((_, i) => rolledText(first + i, this.records[first + i - 1])));
    }
  }

  /** The newest record (the answer a follow-up relates to). */
  last(): TurnRecord | undefined { return this.records[this.records.length - 1]; }
  /** Number of answers recorded (A1…An). */
  get size(): number { return this.records.length; }

  /** The MEMORY block ('' before the first answer). */
  text(): string {
    if (!this.records.length) return '';
    return [
      'MEMORY (what you already taught this student on this document, oldest first: each answer\'s question, how it followed the one before and which question its thread is still on, the pages it taught from, its plan, the parts of the question it covered and left, the board it left — each drawn thing as kind, id, "label", [the data it was built from] and the words it was drawn on — its constants, what it changed, what it said and the question it asked)',
      ...(this.rolled.length ? ['earlier, in short:', ...this.rolled.map((l) => `  ${l}`)] : []),
      ...this.entries,
    ].join('\n');
  }

  reset(): void { this.records = []; this.entries = []; this.rolled = []; this.roots = []; }
}
