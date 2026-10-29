// scripts/eval/replayStress.ts — replays every recorded stage-2 script through the parser and the
// engine's resolution, offline and free (no browser, no API): how many actions would be skipped, and
// why, by tag type.
//   npm run replay-stress [-- --json out.json] [--dirs a,b] [--verbose]
// Sources (deduplicated by script): eval runs (.petu/eval/runs/*/<Q>/result.json), the lessons smoke
// recordings (.petu/lessons-smoke/*/*.json) and scratchpad smoke JSON (PETU_SMOKE_DIRS, comma-separated).
//
// What runs, in stream order, per answer: ScriptParser (malformed and unclosed tags); the resolver's
// lookahead (Figures.note on every action) then Figures.resolve with the answer's real grounding (the
// pages the answer sent with listings: the visible page plus the scout's pages, grounded from the PDF
// with the app's own groundPage); page quotes through locateQuote against that page's text runs; board
// sections, ids and references; the kit's own computeSource for grids and bars; plot fns through the
// toolkit's expression parser. Not modelled: layout, timeouts, KaTeX, and the student driving the
// view. Answers whose PDF is unknown or missing still get every check that needs no page; their page
// marks and quotes count as `unverified`, never as skips.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ScriptParser } from '../../src/script/parser.ts';
import { blockPart } from '../../src/script/pointExpr.ts';
import { colRef } from '../../src/script/parseKit.ts';
import type { RawAction } from '../../src/script/types.ts';
import { Figures } from '../../src/geometry/resolve.ts';
import { locateQuote, type TextRun } from '../../src/locate/locateQuote.ts';
import { groundingOf, type PageGround } from '../../src/agent/context/types.ts';
import { computeSource, formula, samplePlot } from '../../src/desk/kit/kit.ts';
import { compileFn } from '../../src/desk/kit/compute.ts';
import { withConsts } from '../../src/values/readout.ts';
import { answerPages } from '../../src/agent/scout.ts';

// ------------------------------------------------------------------------------------------------
// The offline engine

/** What the replay knows about the answer's document. `grounds`: pages sent with listings (marks resolve); `runs`: any page's text runs (quotes resolve). */
export type ReplayEnv = {
  /**
   * How far the parser runs ahead of the words when an action is built: `all` (the whole stream
   * was parsed first) or a number of actions (0 = only what came before it and itself). Default 3.
   */
  lookahead?: 'all' | number;
  numPages?: number;
  grounds?: Map<number, PageGround>;
  runs?: (page: number) => TextRun[] | undefined;
};
/** One action's fate: ok, skipped (with a reason) or unverified (needs a PDF the replay doesn't have). */
export type Outcome = { tag: string; status: 'ok' | 'skip' | 'unverified'; reason?: string };
export type ScriptReport = { outcomes: Outcome[]; malformed: string[]; unclosed: number; /** `let` names dropped by the parser (bad or doubled definitions). */ letDropped: string[] };

/** Reasons without their specifics (`unknown mark #d7` → `unknown mark`), so they count together. */
export function normReason(r: string): string {
  return r
    .replace(/^unknown (point|mark|block|neighbour) .*/, 'unknown $1')
    .replace(/^.* is not a window's output$/, "not a window's output")
    .replace(/^#\S+ is not (a line|text)$/, 'mark is not $1')
    .replace(/^no table .*/, 'no table')
    .replace(/^cycle at .*/, 'cycle in names')
    .replace(/^no line or plot \S+ to (share axes with|put the points on)$/, 'no line or plot to $1')
    .replace(/^bad (fn|formula|domain|t range) .*/, 'bad $1')
    .replace(/^unbound value .*/, 'unbound value')
    .replace(/^\w+\(\) lands too far out$/, 'construction lands too far out');
}

type Block = { id: string; kind: string; vals?: number[][]; win?: unknown; tab?: { heads: string[] }; /** Has a plot's axes (an engine plot, a line-view bars block). */ plot?: boolean };
type PlotTag = Extract<RawAction, { kind: 'plot' }> & { with?: Record<string, number> };

/**
 * How the live engine builds a {{plot}} (src/desk/elements.ts `plot`, src/desk/kit/kit.ts
 * `buildKitPlot`/`makeLineXY`): on hand-drawn {{axes}} (named by axes=, else the section's latest)
 * a fn= over a numeric domain= is sampled into strokes; anything else is an engine plot: sampled with
 * the answer's constants on its own axes, or on axes=' host, which must be an engine plot or a
 * line-view bars block (a scatter hosts nothing). `handAxes(id)`: is `id` (or, with no id, the
 * section's latest) a hand-drawn axes element; `block(id)`: the kit block of that id so far.
 */
export function plotFate(r: PlotTag, id: string | undefined, s: { consts: Record<string, number>; handAxes: (id: string | undefined) => boolean; block: (id: string) => Block | undefined }): { by: 'strokes' | 'kit' } | { skip: string } {
  if (s.handAxes(r.axes) && r.fn && r.domain) {
    if (!formula(r.fn, ['x'], withConsts(s.consts, r.with))) return { skip: 'bad fn' }; // with the constants, as elements.ts
    return { by: 'strokes' };
  }
  if (id && s.block(id)) return { skip: 'duplicate id' };
  const got = samplePlot(r, withConsts(s.consts, r.with));
  if (typeof got === 'string') return { skip: got };
  if (got.ys.filter(Number.isFinite).length < 2) return { skip: 'nothing to plot' };
  if (r.axes && !s.block(r.axes)?.plot) return { skip: `no line or plot ${r.axes} to share axes with` };
  return { by: 'kit' };
}
type Elem = { kind: string; region?: string };
const KIT = new Set(['grid', 'bars', 'scatter', 'table', 'calc', 'fit']);
const REGION_ONLY = new Set(['write', 'axes', 'plot', 'math']);
const tagOf = (a: RawAction) => a.kind;

/** Replays one script. Deterministic; never throws on bad input. */
export function stressScript(script: string, env: ReplayEnv = {}): ScriptReport {
  const malformed: string[] = [];
  const letDropped: string[] = [];
  const warn = console.warn;
  const actions: RawAction[] = [];
  let unclosed = 0;
  console.warn = (...a: unknown[]) => {
    const m = typeof a[0] === 'string' ? a[0] : '';
    if (m.startsWith('[script] skipped malformed tag')) malformed.push(String(a[1]).split(/\s+/)[0] || '?');
    else if (m.startsWith('[script] let:')) letDropped.push(m.includes('twice') ? 'name defined twice' : 'bad definition');
  };
  try {
    const p = new ScriptParser();
    for (const e of [...p.push(script), ...p.end()]) {
      if (e.type === 'action') actions.push(e.action as RawAction);
      else if (e.type === 'word' && e.text.includes('{{')) unclosed++;
    }
  } finally { console.warn = warn; }

  const figures = new Figures(env.grounds ? groundingOf([...env.grounds.values()]) : { mark: () => undefined });
  // Named numbers ({{const}}, or a let of plain numbers), taken when parsed as the director does (prefetch).
  const consts: Record<string, number> = {};
  const defineConsts = (defs: [string, string][]) => {
    for (const [k, v] of defs) { const f = compileFn(v, Object.keys(consts)); const n = f ? f(consts) : NaN; if (Number.isFinite(n)) consts[k.toLowerCase()] = n; }
  };
  // Lookahead: definitions are taken as actions are parsed, a little ahead of the words being built.
  const ahead = env.lookahead === 'all' ? Infinity : env.lookahead ?? 3;
  let noted = 0;
  const noteUpTo = (i: number) => {
    for (; noted < actions.length && noted <= i + ahead; noted++) {
      const n = actions[noted];
      if (n.kind === 'const') defineConsts(n.defs);
      figures.note(n);
    }
  };
  const regions = new Set<string>();
  const elems = new Map<string, Elem>();
  const blocks = new Map<string, Block>();
  const axes = new Set<string>(); // regions with axes
  const outcomes: Outcome[] = [];
  const known = env.grounds != null || env.runs != null;

  for (const [i, a] of actions.entries()) {
    noteUpTo(i);
    if (a.kind === 'let') continue;
    const tag = tagOf(a);
    const done = (reason?: string, unverified = false) => outcomes.push(reason ? { tag, status: 'skip', reason: normReason(reason) } : { tag, status: unverified ? 'unverified' : 'ok' });
    const x = a as Record<string, unknown> & { page?: number; region?: string; id?: string };
    const pageBad = (p: number | undefined) => p != null && env.numPages != null && (p < 1 || p > env.numPages);
    if (a.kind === 'sketch') { regions.add(a.id); done(); continue; }
    if (a.kind === 'clear') { done(); continue; }
    if (a.kind === 'scroll') { done(pageBad(a.page) ? 'page out of range' : undefined); continue; }

    // A bound number: the parser said it with the engine's value; unresolved, the director records a skip.
    if (a.kind === 'val') { done(a.said == null ? `unbound value ${a.ref}` : undefined); continue; }
    // References to earlier elements and kit verbs.
    if ('ref' in a) {
      const ref = String((a as { ref: string }).ref);
      const part = blockPart(ref);
      const base = part ? part.id : colRef(ref)?.[0] ?? ref;
      const b = blocks.get(base), e = elems.get(base);
      if (a.kind === 'step' || a.kind === 'sweep') {
        if (!b?.win) { done(`${base} is not a window's output`); continue; }
        const [R, C] = [b.vals?.length ?? 0, b.vals?.[0]?.length ?? 0];
        if (part && a.kind === 'step') { const r = R === 1 && part.r0 === 0 ? 0 : part.r0; if (r >= R || part.c0 >= C) { done('step outside the output'); continue; } }
        done(); continue;
      }
      if (a.kind === 'col') {
        if (b?.kind !== 'table') { done(`no table ${base}`); continue; }
        if (b.vals) b.vals = b.vals.map((row) => [...row, NaN]);
        done(); continue;
      }
      if (!b && !e) { done('unknown id'); continue; }
      if (a.kind === 'move' && e && e.kind !== 'point' && e.kind !== 'label') { done('not movable'); continue; }
      done(); continue;
    }

    if (a.kind === 'connect') {
      const r = figures.resolve(a);
      if (typeof r === 'string') { done(r); continue; }
      let bad: string | undefined, unverified = false;
      for (const end of [a.from, a.to] as Record<string, unknown>[]) {
        if ('region' in end && end.region != null) {
          if (!regions.has(String(end.region))) { bad = 'unknown region'; break; }
          if ('ref' in end) { const ref = String(end.ref); const id = blockPart(ref)?.id ?? ref; if (!elems.has(id) && !blocks.has(id)) { bad = 'unknown id'; break; } }
        } else if ('page' in end) {
          if (pageBad(end.page as number)) { bad = 'page out of range'; break; }
          if ('quote' in end) {
            const runs = env.runs?.(end.page as number);
            if (!runs) unverified = true;
            else if (!locateQuote(runs, String(end.quote), end.near as never).length) { bad = 'connector anchor not found'; break; }
          }
        }
      }
      done(bad, unverified);
      if (!bad && x.id) elems.set(x.id, { kind: 'connect' });
      continue;
    }

    // Drawn elements and kit blocks: their target first.
    if (x.region != null && !regions.has(x.region)) { done('unknown region'); continue; }
    if (x.page != null && pageBad(x.page)) { done('page out of range'); continue; }
    if (KIT.has(a.kind) && x.region == null) { done('kit blocks live on the board'); continue; }
    if (REGION_ONLY.has(a.kind) && x.region == null) { done('not drawable here'); continue; }

    if (KIT.has(a.kind)) {
      if (x.id && (blocks.has(x.id) || elems.has(x.id))) { done('duplicate id'); continue; }
      const id = x.id ?? `_${blocks.size}`;
      const k = a as unknown as Record<string, unknown>;
      if (a.kind === 'grid' || a.kind === 'bars') {
        const got = computeSource(k.src as never, (i) => blocks.get(i) as never, id, withConsts(consts, k.with as Record<string, number> | undefined));
        if (typeof got === 'string') { done(got); continue; }
        let full = got.full;
        if (a.kind === 'bars' && !got.win && full.length > 1 && full.every((r) => r.length === 1)) full = [full.map((r) => r[0])];
        if (a.kind === 'bars' && full.length !== 1) { done('bars need one row'); continue; }
        // A vector shown as a line (view=line, or past 16 values) has a plot's axes: plots and scatters may share them.
        const line = a.kind === 'bars' && (k.view === 'line' || (full[0]?.length ?? 0) > 16);
        if (line) {
          if (full[0].filter(Number.isFinite).length < 2) { done('a line needs two values'); continue; }
          if (k.axes && !blocks.get(String(k.axes))?.plot) { done(`no line or plot ${k.axes} to share axes with`); continue; }
        }
        blocks.set(id, { id, kind: a.kind, vals: full, ...(got.win ? { win: got.win } : {}), ...(line ? { plot: true } : {}) });
      } else if (a.kind === 'table') {
        blocks.set(id, { id, kind: 'table', vals: (k.vals as number[][]).map((r) => r.slice()), tab: { heads: k.heads as string[] } });
      } else if (a.kind === 'scatter') {
        const cols = k.cols as { id: string; x: number; y: number } | undefined;
        if (cols) { const t = blocks.get(cols.id); if (t?.kind !== 'table') { done(`no table ${cols.id}`); continue; } const n = t.vals?.[0]?.length ?? 0; if (cols.x >= n || cols.y >= n) { done('no such column'); continue; } }
        else if (((k.data as unknown[]) ?? []).length < 2) { done('scatter needs two points'); continue; }
        // axes=: onto a line's or plot's axes (a scatter has no axes another chart can share).
        if (k.axes && !blocks.get(String(k.axes))?.plot) { done(`no line or plot ${k.axes} to put the points on`); continue; }
        blocks.set(id, { id, kind: 'scatter' });
      } else if (a.kind === 'calc') {
        if ((k.of as string[]).some((i) => !blocks.get(i)?.vals)) { done('unknown block'); continue; }
        blocks.set(id, { id, kind: 'calc' });
      } else if (a.kind === 'fit') {
        if (blocks.get(String(k.of))?.kind !== 'scatter') { done('unknown block'); continue; }
        blocks.set(id, { id, kind: 'fit' });
      }
      done(); continue;
    }

    // Plain shapes: names, marks and constructions resolve first (as at build time).
    const res = figures.resolve(a);
    if (res == null) { done('nothing to draw'); continue; }
    if (typeof res === 'string') {
      // A page mark on a page the replay has no grounding for is unknown here, not necessarily live.
      if (!known && x.page != null) { done(undefined, true); continue; }
      done(res); continue;
    }
    const r = res as Record<string, unknown> & { page?: number; region?: string };
    if (a.kind === 'plot') {
      const fate = plotFate(r as PlotTag, x.id, { consts, handAxes: (id) => (id != null ? elems.get(id)?.kind === 'axes' : axes.has(String(r.region))), block: (id) => blocks.get(id) });
      if ('skip' in fate) { done(fate.skip); continue; }
      if (fate.by === 'kit') {
        // An engine plot is a kit block with axes of its own (or its host's): later plots, lines and scatters may share them.
        const id = x.id ?? `_${blocks.size}`;
        blocks.set(id, { id, kind: 'plot', plot: true });
        done(); continue;
      }
    }
    if (r.page != null && typeof r.quote === 'string') {
      const runs = env.runs?.(r.page);
      if (!runs) { done(undefined, true); continue; }
      if (!locateQuote(runs, r.quote, r.near as never).length) { done(a.kind === 'highlight' || a.kind === 'underline' ? 'quote not found' : 'anchor not found'); continue; }
    }
    if (a.kind === 'axes') axes.add(String(x.region));
    if (x.id) elems.set(x.id, { kind: a.kind, region: x.region });
    done();
  }
  return { outcomes, malformed, unclosed, letDropped };
}

// ------------------------------------------------------------------------------------------------
// Recordings

export type Recording = {
  source: 'eval' | 'smoke' | 'scratch';
  label: string;
  script: string;
  /** Deck id or a PDF path, when known. */
  pdf?: string;
  page?: number;
  scoutPages?: number[];
  /** Skips the live run recorded (tag → reason), when it recorded them. */
  live?: { tag: string; reason: string }[];
  liveActions?: number;
};

const readJson = (p: string): unknown => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const scoutOf = (events: unknown): number[] | undefined => {
  const ev = Array.isArray(events) ? events.find((e) => (e as { t?: string }).t === 'scout') as { pages?: number[] } | undefined : undefined;
  return ev?.pages;
};
type Timing = { action?: { kind?: string }; skipped?: string };
const liveOf = (timings: unknown) => Array.isArray(timings)
  ? { live: (timings as Timing[]).filter((t) => t.skipped).map((t) => ({ tag: t.action?.kind ?? '?', reason: normReason(t.skipped!) })), liveActions: (timings as Timing[]).filter((t) => t.action?.kind !== 'let').length }
  : {};

/** Eval runs: every `<run>/<Q>/result.json` (one recording per turn). `srcToPdf` maps the app's src to a local PDF path. */
export function collectEval(runsDir: string, srcToPdf: (src: string) => string | null): Recording[] {
  const out: Recording[] = [];
  if (!isDir(runsDir)) return out;
  for (const run of readdirSync(runsDir).sort()) {
    const rd = join(runsDir, run);
    if (!isDir(rd)) continue;
    for (const q of readdirSync(rd).sort()) {
      const f = join(rd, q, 'result.json');
      if (!existsSync(f)) continue;
      const d = readJson(f) as { open?: { src: string; page: number }; turns?: { chunks?: { d: string }[]; events?: unknown; timings?: unknown; page?: number }[] } | null;
      if (!d?.turns) continue;
      d.turns.forEach((t, i) => {
        const script = (t.chunks ?? []).map((c) => c.d).join('');
        if (!script.trim()) return;
        out.push({ source: 'eval', label: `${run}/${q}${i ? `#${i + 1}` : ''}`, script, pdf: d.open ? srcToPdf(d.open.src) ?? undefined : undefined, page: d.open?.page, scoutPages: scoutOf(t.events), ...liveOf(t.timings) });
      });
    }
  }
  return out;
}

/** The lessons smoke runs: `<dir>/<round>/<id>.json` with page, scout, script and result. `deckOf` maps the id to a deck. */
export function collectSmoke(dir: string, deckOf: (id: string) => string | undefined): Recording[] {
  const out: Recording[] = [];
  if (!isDir(dir)) return out;
  for (const round of readdirSync(dir).sort()) {
    const rd = join(dir, round);
    if (!isDir(rd)) continue;
    for (const f of readdirSync(rd).filter((n) => n.endsWith('.json')).sort()) {
      const d = readJson(join(rd, f)) as { id?: string; page?: number; scout?: { pages?: number[] }; script?: string; result?: { timings?: unknown } } | null;
      if (!d?.script) continue;
      out.push({ source: 'smoke', label: `${round}/${f}`, script: d.script, pdf: d.id ? deckOf(d.id) : undefined, page: d.page, scoutPages: d.scout?.pages, ...liveOf(d.result?.timings) });
    }
  }
  return out;
}

/** Scratchpad smoke JSON, any depth: `{q, script, skipped: [[tag, reason]]}` or `{row: {deck, page, pages}, openerText, stage2Text}`. */
export function collectScratch(dir: string): Recording[] {
  const out: Recording[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (isDir(p)) { walk(p); continue; }
      if (!n.endsWith('.json')) continue;
      const j = readJson(p) as { script?: string; skipped?: [string, string][]; row?: { deck?: string; page?: number; pages?: number[] }; openerText?: string; stage2Text?: string } | null;
      if (!j || Array.isArray(j)) continue;
      if (typeof j.script === 'string') {
        out.push({ source: 'scratch', label: p.slice(dir.length + 1), script: j.script, ...(Array.isArray(j.skipped) ? { live: j.skipped.map(([tag, reason]) => ({ tag, reason: normReason(reason) })) } : {}) });
      } else if (typeof j.stage2Text === 'string' && j.row) {
        out.push({ source: 'scratch', label: p.slice(dir.length + 1), script: `${j.openerText ?? ''} ${j.stage2Text}`, pdf: j.row.deck, page: j.row.page, scoutPages: j.row.pages });
      }
    }
  };
  if (isDir(dir)) walk(dir);
  return out;
}

/** One recording per distinct script (replay runs re-play the same chunks); the first label wins. */
export function dedupe(rs: Recording[]): Recording[] {
  const seen = new Set<string>();
  return rs.filter((r) => { const h = createHash('sha1').update(r.script).digest('hex'); if (seen.has(h)) return false; seen.add(h); return true; });
}

// ------------------------------------------------------------------------------------------------
// Report

export type TagRow = { tag: string; n: number; skipped: number; unverified: number; reasons: Record<string, number> };
export type StressSummary = {
  recordings: number; withPdf: number; actions: number; skipped: number; unverified: number; skipRate: number;
  malformed: number; malformedByTag: Record<string, number>; unclosed: number; letDropped: Record<string, number>;
  /** Eval recordings by prompt version (from the run id), the current prompt's share in particular. */
  byPrompt: Record<string, { recordings: number; actions: number; skipped: number; malformed: number }>;
  byTag: TagRow[];
  bySource: Record<string, { recordings: number; actions: number; skipped: number }>;
  live?: { recordings: number; liveActions: number; liveSkipped: number; agreeing: number; liveOnly: Record<string, number>; offlineOnly: Record<string, number> };
};

export function summarise(items: { rec: Recording; rep: ScriptReport; grounded: boolean }[]): StressSummary {
  const tags = new Map<string, TagRow>();
  const bySource: StressSummary['bySource'] = {};
  const malformedByTag: Record<string, number> = {};
  const letDropped: Record<string, number> = {};
  const byPrompt: StressSummary['byPrompt'] = {};
  let actions = 0, skipped = 0, unverified = 0, malformed = 0, unclosed = 0;
  let liveRecs = 0, liveActions = 0, liveSkipped = 0, agreeing = 0;
  const liveOnly: Record<string, number> = {}, offlineOnly: Record<string, number> = {};
  for (const { rec, rep } of items) {
    const s = (bySource[rec.source] ??= { recordings: 0, actions: 0, skipped: 0 });
    s.recordings++;
    for (const o of rep.outcomes) {
      const t = tags.get(o.tag) ?? { tag: o.tag, n: 0, skipped: 0, unverified: 0, reasons: {} };
      t.n++; actions++; s.actions++;
      if (o.status === 'skip') { t.skipped++; skipped++; s.skipped++; t.reasons[o.reason!] = (t.reasons[o.reason!] ?? 0) + 1; }
      if (o.status === 'unverified') { t.unverified++; unverified++; }
      tags.set(o.tag, t);
    }
    malformed += rep.malformed.length; unclosed += rep.unclosed;
    for (const l of rep.letDropped) letDropped[l] = (letDropped[l] ?? 0) + 1;
    const pv = rec.source === 'eval' ? /-(p\d+\.\d+)-/.exec(rec.label)?.[1] ?? 'other' : rec.source;
    const bp = (byPrompt[pv] ??= { recordings: 0, actions: 0, skipped: 0, malformed: 0 });
    bp.recordings++; bp.actions += rep.outcomes.length; bp.skipped += rep.outcomes.filter((o) => o.status === 'skip').length; bp.malformed += rep.malformed.length;
    for (const m of rep.malformed) malformedByTag[m] = (malformedByTag[m] ?? 0) + 1;
    if (rec.live && rec.liveActions != null) {
      liveRecs++; liveActions += rec.liveActions; liveSkipped += rec.live.length;
      // Agreement: the multiset of (tag, reason) skipped live and offline.
      const off = rep.outcomes.filter((o) => o.status === 'skip').map((o) => `${o.tag}|${o.reason}`);
      for (const l of rec.live) {
        const k = `${l.tag}|${l.reason}`, i = off.indexOf(k);
        if (i >= 0) { agreeing++; off.splice(i, 1); } else liveOnly[k] = (liveOnly[k] ?? 0) + 1;
      }
      for (const k of off) offlineOnly[k] = (offlineOnly[k] ?? 0) + 1;
    }
  }
  const checked = actions - unverified;
  return {
    recordings: items.length, withPdf: items.filter((i) => i.grounded).length, actions, skipped, unverified,
    skipRate: checked ? Math.round((1000 * skipped) / checked) / 1000 : 0,
    malformed, malformedByTag, unclosed, letDropped, byPrompt,
    byTag: [...tags.values()].sort((a, b) => b.skipped - a.skipped || b.n - a.n),
    bySource,
    ...(liveRecs ? { live: { recordings: liveRecs, liveActions, liveSkipped, agreeing, liveOnly, offlineOnly } } : {}),
  };
}

export function formatSummary(s: StressSummary): string {
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
  const out = [
    `replay-stress: ${s.recordings} distinct scripts (${s.withPdf} with their PDF), ${s.actions} actions`,
    `skipped ${s.skipped} (${pct(s.skipped, s.actions - s.unverified)} of checked), unverified ${s.unverified}, malformed tags ${s.malformed}${s.malformed ? ` (${Object.entries(s.malformedByTag).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}, unclosed ${s.unclosed}`,
    '',
    `skip rate: ${pct(s.skipped, s.actions - s.unverified)}`,
    '',
    'tag          n  skip   rate  unverified  reasons',
    ...s.byTag.map((t) => `${t.tag.padEnd(10)} ${String(t.n).padStart(4)} ${String(t.skipped).padStart(5)} ${pct(t.skipped, t.n - t.unverified).padStart(6)} ${String(t.unverified).padStart(10)}  ${Object.entries(t.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ×${n}`).join('; ')}`),
    '',
    ...Object.entries(s.bySource).map(([k, v]) => `${k}: ${v.recordings} scripts, ${v.actions} actions, ${v.skipped} skipped (${pct(v.skipped, v.actions)})`),
    `by prompt: ${Object.entries(s.byPrompt).sort().map(([k, v]) => `${k} ${v.recordings} scripts ${v.skipped}/${v.actions} skipped, ${v.malformed} malformed`).join(' · ')}`,
    `let names dropped by the parser: ${Object.entries(s.letDropped).map(([k, v]) => `${k} ×${v}`).join('; ') || '0'}`,
  ];
  if (s.live) {
    const list = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.replace('|', ': ')} ×${n}`).join('; ') || '–';
    out.push(`live recordings: ${s.live.recordings} scripts, ${s.live.liveSkipped}/${s.live.liveActions} skipped live; ${s.live.agreeing} of those also skipped offline with the same reason`);
    out.push(`  live only: ${list(s.live.liveOnly)}`);
    out.push(`  offline only: ${list(s.live.offlineOnly)}`);
  }
  return out.join('\n');
}

// ------------------------------------------------------------------------------------------------
// CLI

/** Where `.petu/` lives: PETU_DATA_ROOT, else `cwd` when it has eval runs, else the main checkout (git common dir). */
export function dataRoot(cwd: string): string {
  if (process.env.PETU_DATA_ROOT) return process.env.PETU_DATA_ROOT;
  if (isDir(join(cwd, '.petu/eval/runs'))) return cwd;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
    const main = dirname(common);
    if (isDir(join(main, '.petu'))) return main;
  } catch { /* not a git checkout */ }
  return cwd;
}

/** The lessons smoke ids → course deck (scratchpad smoke.ts). */
export const SMOKE_DECKS: Record<string, string> = { ransac: 'lec08', corner: 'lec07', symbol: 'lec07', pinhole: 'lec02', handin: 'hw2' };

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  // Recordings and course PDFs are gitignored: in a worktree they live in the main checkout (as the gallery's runs do).
  const root = dataRoot(process.cwd());
  const { deckPath: deckAt, pathOfSrc: srcAt, knownDeck, pdfDirs } = await import('./decks.ts');
  const deckPath = (d: string) => deckAt(d, pdfDirs(root), root);
  const pathOfSrc = (s: string) => srcAt(s, pdfDirs(root), root);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { groundPage } = await import('../../src/agent/context/build.ts');
  const OPS = pdfjs.OPS as unknown as Record<string, number>;
  const scratch = (opt('--dirs') ?? process.env.PETU_SMOKE_DIRS ?? '').split(',').filter(Boolean);
  const recs = dedupe([
    ...collectEval(join(root, '.petu/eval/runs'), (src) => pathOfSrc(src)),
    ...collectSmoke(join(root, '.petu/lessons-smoke'), (id) => SMOKE_DECKS[id]),
    ...scratch.flatMap((d) => collectScratch(d)),
  ]);
  const docs = new Map<string, Promise<{ numPages: number; getPage(n: number): Promise<unknown> } | null>>();
  const grounds = new Map<string, Promise<PageGround | null>>();
  const pathOf = (pdf: string) => { try { return pdf.endsWith('.pdf') ? pdf : knownDeck(pdf) ? deckPath(pdf) : null; } catch { return null; } };
  const open = (path: string) => {
    if (!docs.has(path)) docs.set(path, pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise.catch(() => null) as never);
    return docs.get(path)!;
  };
  const ground = (path: string, page: number) => {
    const k = `${path}#${page}`;
    if (!grounds.has(k)) grounds.set(k, open(path).then(async (d) => (d && page >= 1 && page <= d.numPages ? groundPage(await d.getPage(page) as never, OPS) : null)).catch(() => null));
    return grounds.get(k)!;
  };
  const items: { rec: Recording; rep: ScriptReport; grounded: boolean }[] = [];
  for (const rec of recs) {
    const path = rec.pdf ? pathOf(rec.pdf) : null;
    let env: ReplayEnv = {};
    if (path && rec.page) {
      const d = await open(path);
      if (d) {
        const listed = answerPages(rec.page, rec.scoutPages ?? []);
        const quotePages = new Set<number>(listed);
        for (const m of rec.script.matchAll(/\bp=(\d+)/g)) quotePages.add(Number(m[1]));
        const gs = new Map<number, PageGround>();
        for (const p of quotePages) { const g = await ground(path, p); if (g) gs.set(p, g); }
        const listedGrounds = new Map([...gs].filter(([p]) => listed.includes(p)));
        env = { numPages: d.numPages, grounds: listedGrounds, runs: (p) => { const g = gs.get(p); return g ? g.lines.flatMap((l) => l.runs) : undefined; } };
      }
    }
    const rep = stressScript(rec.script, env);
    items.push({ rec, rep, grounded: env.grounds != null });
    if (argv.includes('--verbose')) for (const o of rep.outcomes.filter((x) => x.status === 'skip')) console.log(`  ${rec.label}: ${o.tag} — ${o.reason}`);
  }
  const s = summarise(items);
  console.log(formatSummary(s));
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify(s, null, 1));
  for (const d of docs.values()) (await d as { destroy?: () => Promise<void> } | null)?.destroy?.();
}
