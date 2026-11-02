// scripts/eval/metrics.ts — pure metrics over one recorded answer (`__petu.result()`).
// Geometry comes from the engine's registry and timing log, never from pixels.
import type { EvalResult, RegistryRow, SerialTiming } from '../../src/agent/evalHooks.ts';
import type { ScriptParse } from './scriptTags.ts';
import type { GateEvent, RepairEvent } from '../../src/gate/events.ts';
import { PacedClock } from '../../src/playback/clock.ts';
import { BASE_WPM } from '../../src/settings/settings.ts';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type Metrics = {
  ttftMs: number | null; firstWordMs: number | null; firstMarkMs: number | null; totalMs: number | null;
  /**
   * How long the answer talks: from its first word to the end of its last sentence (ms). Separate from
   * the wait before it (firstWordMs) and from totalMs (the last action's end, which includes ink after
   * the last word).
   */
  spokenMs: number | null;
  /**
   * When the author's (stage 2's) first text arrived, ms since Enter (the handoff; without an opener
   * its first chunk), and the silence it left after the opener's last word (0 when it was in time).
   * The first word itself is usually the scout's opener, the same for every author.
   */
  stage2Ms: number | null;
  handoffGapMs: number | null;
  /**
   * The silence the student actually hears at the seam: from the opener's last word ending to stage 2's
   * first spoken word starting (ms; 0 when it follows on time). handoffGapMs times stage 2's first chunk,
   * which in the svg format is the board tag or a group, never a word, so it under-reports. Null without
   * an opener, or when stage 2 spoke nothing.
   */
  silenceMs: number | null;
  /** After that seam: silences over MID_SILENCE_MS between spoken words (count, and the longest, ms). */
  midSilences: number;
  midSilenceMaxMs: number;
  /** Stage 2's cost (the `done` event). */
  usd: number;
  /** The scout's cost (the `scout` event). */
  scoutUsd: number;
  /** Everything the answer cost: scout + stage 2 + live-gate repairs. */
  answerUsd: number;
  cachedShare: number; estimated: boolean;
  tags: number; malformed: number; linted: number; skipped: Record<string, number>; skippedTotal: number;
  /** Skipped actions whose id a later action names (the student never saw what came after them either). */
  skippedDeps: number;
  /** A skip defect: more than two skips (malformed tags count), or a skipped action others depend on. */
  skipDefect: boolean;
  elements: number; maxNewPerSentence: number;
  floatingPoints: number; onLineErrors: number;
  labelHits: number; labelsClipped: number; outOfFrame: number;
  words: number; longestSentence: number; wordsBeforeFirstMark: number; leaks: number;
  takeawayFirst: boolean; planChars: number; droppedMessages: number;
  /** The live gate (design 2026-10-29 §8), when the answer was gated (any gate event recorded). */
  gate?: GateMetrics;
};

/**
 * One gated answer. `holds`: silences > 1 s between spoken words after the first (a hold the gate or a
 * repair caused counts; so does any other stall). `seamMs`: the silence at the opener→stage-2 seam (the
 * first word at or after the handoff minus the word before it). `liveSkipAfterPass`: actions the live
 * board skipped although their unit passed (every played unit passed the gate, so every live skip in a
 * gated answer). `shadowDrift`: units whose notes say the shadow board disagreed with the live one.
 */
export type GateMetrics = {
  units: number; fails: number; strips: number; drops: number; droppedWords: number;
  repairs: number; repairOk: number; repairLate: number; repairFail: number; repairRefused: number; repairUsd: number; repairMs: number[];
  holds: number; seamMs: number | null; shadowMs: number[]; liveSkipAfterPass: number; shadowDrift: number; cascades: number;
};
export const HOLD_MS = 1000;
/** A mid-answer silence worth counting (the no-dead-air target: none over 1.5 s). */
export const MID_SILENCE_MS = 1500;

/**
 * The true silences of one answer (see Metrics.silenceMs). The seam: the handoff's `openerEndMs` is when
 * the opener's queued words end; stage 2's first word is the first one starting at or after both that
 * and the handoff. Gaps after it are word start to next word start minus the word's own paced length.
 */
export function silences(r: Pick<EvalResult, 'events' | 'words'>): { silenceMs: number | null; midSilences: number; midSilenceMaxMs: number } {
  const ho = r.events.find((e) => e.t === 'handoff') as { ms: number; openerEndMs?: number } | undefined;
  let i = 0, silenceMs: number | null = null;
  if (ho?.openerEndMs != null) {
    const from = Math.max(ho.openerEndMs, ho.ms);
    i = r.words.findIndex((w) => w.t >= from - 1);
    if (i >= 0) silenceMs = Math.max(0, Math.round(r.words[i].t - ho.openerEndMs));
  }
  let midSilences = 0, midSilenceMaxMs = 0;
  if (i >= 0) {
    for (let k = Math.max(1, i + 1); k < r.words.length; k++) {
      const gap = r.words[k].t - r.words[k - 1].t - paced.durationMs(r.words[k - 1].text);
      if (gap > MID_SILENCE_MS) midSilences++;
      midSilenceMaxMs = Math.max(midSilenceMaxMs, Math.round(gap));
    }
  }
  return { silenceMs, midSilences, midSilenceMaxMs };
}

/** The narration's own pacing: a word's spoken length with its clause/sentence pause (the app's default clock). */
const paced = new PacedClock(() => BASE_WPM);
/**
 * Silences longer than HOLD_MS between spoken words: the time from a word's start to the next word's,
 * minus the word's own paced length (a five-syllable word before a full stop takes 1.1 s to say; that
 * is speech, not a hold). Word times are recorded starts; durations are the default clock's.
 */
export function holdCount(words: readonly { text: string; t: number }[]): number {
  let n = 0;
  for (let i = 1; i < words.length; i++) if (words[i].t - words[i - 1].t - paced.durationMs(words[i - 1].text) > HOLD_MS) n++;
  return n;
}

export function gateMetrics(r: Pick<EvalResult, 'events' | 'words' | 'timings'>): GateMetrics | undefined {
  const gs = r.events.filter((e): e is GateEvent => e.t === 'gate');
  const rs = r.events.filter((e): e is RepairEvent => e.t === 'repair');
  if (!gs.length && !rs.length) return undefined;
  const handoff = r.events.find((e) => e.t === 'handoff') as { ms: number } | undefined;
  let seamMs: number | null = null;
  if (handoff) {
    const i = r.words.findIndex((w) => w.t >= handoff.ms);
    if (i > 0) seamMs = Math.max(0, r.words[i].t - r.words[i - 1].t);
  }
  const holds = holdCount(r.words);
  const sentAt = new Map<string, number>();
  const repairMs: number[] = [];
  for (const e of rs) {
    if (e.phase === 'sent') { sentAt.set(e.k, e.ms); continue; }
    if (e.phase === 'ok') { const s = sentAt.get(e.k); repairMs.push(s != null && s <= e.ms ? e.ms - s : e.ms); }
  }
  const noted = (g: GateEvent, word: string) => g.notes.some((n) => n.toLowerCase().includes(word)) || g.flags.some((f) => f.check.toLowerCase().includes(word));
  return {
    units: gs.filter((g) => !g.repaired).length,
    fails: gs.filter((g) => g.result === 'fail').length,
    strips: gs.filter((g) => g.result === 'strip').length,
    drops: gs.filter((g) => g.action === 'drop').length,
    droppedWords: gs.filter((g) => g.action === 'drop').reduce((s, g) => s + (g.words ?? (g.text ? wordCount(g.text.replace(/\{\{[^}]*\}\}/g, ' ')) : 0)), 0),
    repairs: rs.filter((e) => e.phase === 'sent').length,
    repairOk: rs.filter((e) => e.phase === 'ok').length,
    repairLate: rs.filter((e) => e.phase === 'late').length,
    repairFail: rs.filter((e) => e.phase === 'fail').length,
    repairRefused: rs.filter((e) => e.phase === 'refused' || e.phase === 'error').length,
    repairUsd: rs.reduce((s, e) => s + (e.usd ?? 0), 0),
    repairMs,
    holds, seamMs,
    shadowMs: gs.map((g) => g.ms),
    liveSkipAfterPass: r.timings.filter((t) => t.skipped).length,
    shadowDrift: gs.filter((g) => noted(g, 'drift')).length,
    cascades: gs.filter((g) => noted(g, 'cascade')).length,
  };
}

export const NON_DRAWING = new Set(['scroll', 'sketch', 'clear', 'let', 'emph', 'move', 'fade']);
const LAYOUT = new Set(['scroll', 'sketch', 'clear', 'let']);
const TEXT_KINDS = new Set(['label', 'write', 'math']);
const REGION = { w: 1000, h: 700 }, PAGE = { w: 1000, h: 1000 };
export const FLOAT_GAP = 8;
const HEDGE = /^(so|well|okay|great|let me|to answer|first)/i;

const kindOf = (t: SerialTiming): string => String(t.action.kind ?? '');
/** An action that drew something: not layout/bookkeeping, not skipped, and its ink started. */
const drew = (t: SerialTiming): boolean => !t.skipped && !NON_DRAWING.has(kindOf(t)) && t.startedAt != null;

/** Does segment a-b touch the rectangle? (Liang-Barsky clip.) */
export function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - r.x) && clip(dx, r.x + r.w - a.x) && clip(-dy, a.y - r.y) && clip(dy, r.y + r.h - a.y);
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const sameTarget = (a: RegistryRow, b: RegistryRow) =>
  a.target.region != null ? a.target.region === b.target.region : a.target.page === b.target.page;
const segs = (rows: RegistryRow[]) => rows.flatMap((r) => r.strokes.flatMap((s) => s.slice(1).map((p, i) => ({ a: s[i], b: p }))));

export function floatingPoints(reg: RegistryRow[]): number {
  let n = 0;
  for (const p of reg) {
    if (p.kind !== 'point' || p.target.region == null) continue;
    const c = { x: p.bbox.x + p.bbox.w / 2, y: p.bbox.y + p.bbox.h / 2 };
    // Other points are not anchors: a point must sit on some other element's stroke.
    const others = segs(reg.filter((o) => o !== p && o.kind !== 'point' && sameTarget(o, p)));
    if (others.every((s) => distToSeg(c, s.a, s.b) >= FLOAT_GAP)) n++;
  }
  return n;
}

export function labelStats(reg: RegistryRow[]): { hits: number; clipped: number } {
  let hits = 0, clipped = 0;
  for (const l of reg) {
    if (l.kind !== 'label') continue;
    const boxes = l.boxes.length ? l.boxes : [l.bbox];
    const lim = l.target.region != null ? REGION : PAGE;
    const sg = segs(reg.filter((o) => o !== l && sameTarget(o, l)));
    if (boxes.some((b) => sg.some((s) => segHitsRect(s.a, s.b, b)))) hits++;
    const bb = l.bbox;
    if (bb.x <= 0 || bb.y <= 0 || bb.x + bb.w >= lim.w || bb.y + bb.h >= lim.h) clipped++;
  }
  return { hits, clipped };
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const LEAK = [/\*\*/g, /`/g, /\\\(/g, /\$/g, /#/g];

/**
 * `parsed` (scriptTags.ts `parseScript` over the answer's text) gives the parser's own count of
 * malformed tags (rejected plus unclosed) and the {{find}} readouts, which have no timing but depend
 * on their source (a skipped plot a find reads has dependents). Without it the count is estimated from tag names and
 * timings ({{let}}, {{const}}, {{find}} and {{val}} have no timing of their own when they work).
 */
export function computeMetrics(r: EvalResult, parsed?: ScriptParse): Metrics {
  const done = r.events.find((e) => e.t === 'done') as Extract<EvalResult['events'][number], { t: 'done' }> | undefined;
  const text = r.chunks.map((c) => c.d).join('');
  const tags = (text.match(/\{\{/g) ?? []).length;
  // Estimate only: tags that work without a timed action of their own are not malformed.
  const untimed = (text.match(/\{\{\s*(let|const|find|val)\b/g) ?? []).length;
  const malformed = parsed ? parsed.malformed : Math.max(0, tags - untimed - r.timings.filter((t) => t.action.kind !== 'val').length);
  const drawn = r.timings.filter(drew);
  const firstDraw = drawn.reduce<SerialTiming | null>((m, t) => (m == null || (t.firedAt ?? Infinity) < (m.firedAt ?? Infinity) ? t : m), null);
  const firstMark = drawn.filter((t) => !LAYOUT.has(kindOf(t))).reduce<number | null>((m, t) => (m == null || t.startedAt! < m ? t.startedAt! : m), null);
  const ends = r.timings.filter((t) => !t.skipped && t.endedAt != null).map((t) => t.endedAt!);

  const skipped: Record<string, number> = {};
  for (const t of r.timings) if (t.skipped) { const k = t.skipped.split(/[:(]/)[0].trim() || 'skipped'; skipped[k] = (skipped[k] ?? 0) + 1; }

  // Drawing actions fired within each sentence: sentence i spans (end[i-1], end[i]]; the last one runs on.
  const bounds = r.sentences.map((s) => s.endMs);
  let maxNew = 0;
  if (bounds.length) {
    const counts = bounds.map(() => 0);
    for (const t of drawn) {
      if (LAYOUT.has(kindOf(t))) continue;
      const f = t.firedAt ?? 0;
      let i = bounds.findIndex((b) => f <= b);
      if (i < 0) i = bounds.length - 1;
      counts[i]++;
    }
    maxNew = Math.max(...counts);
  }

  const narration = r.words.map((w) => w.text).join(' ');
  const first = r.sentences[0];
  const takeaway = !!first && wordCount(first.text) <= 18 && !HEDGE.test(first.text.trim()) &&
    r.timings.some((t) => drew(t) && !LAYOUT.has(kindOf(t)) && (t.firedAt ?? Infinity) <= first.endMs);
  const cached = done?.usage?.input_tokens_details?.cached_tokens ?? 0;
  // A skipped block (or element) that later actions name by id: they lose their source or anchor too.
  const order = r.timings.map((t, i) => ({ t, i })).sort((a, b) => (a.t.firedAt ?? 0) - (b.t.firedAt ?? 0) || a.i - b.i).map((x) => x.t);
  const deps = order.filter((t, i) => {
    const id = t.skipped ? t.action.id : undefined;
    if (typeof id !== 'string' || !id) return false;
    const re = new RegExp(`(^|[^A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
    const strs = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strs) : v && typeof v === 'object' ? Object.values(v).flatMap(strs) : []);
    return order.slice(i + 1).some((u) => { const { kind: _k, ...rest } = u.action; void _k; return strs(rest).some((x) => re.test(x)); }) ||
      !!parsed?.tags.some((g) => g.of?.some((x) => re.test(x)));
  }).length;
  const labels = labelStats(r.registry);
  const scoutUsd = r.events.reduce((s, e) => s + (e.t === 'scout' ? (e.usd ?? 0) : 0), 0);
  const handoff = r.events.find((e) => e.t === 'handoff') as Extract<EvalResult['events'][number], { t: 'handoff' }> | undefined;
  const gm = gateMetrics(r);
  const sil = silences(r);
  const lastSpoken = r.sentences.length ? r.sentences[r.sentences.length - 1].endMs : r.words.length ? r.words[r.words.length - 1].t : null;

  return {
    ttftMs: r.chunks[0]?.t ?? done?.ttftMs ?? null,
    firstWordMs: r.words[0]?.t ?? null,
    firstMarkMs: firstMark,
    totalMs: ends.length ? Math.max(...ends) : null,
    spokenMs: r.words.length && lastSpoken != null ? Math.max(0, lastSpoken - r.words[0].t) : null,
    stage2Ms: handoff?.ms ?? r.chunks[0]?.t ?? null,
    handoffGapMs: handoff?.openerEndMs != null ? Math.max(0, handoff.ms - handoff.openerEndMs) : null,
    ...sil,
    usd: done?.usd ?? 0,
    scoutUsd,
    answerUsd: (done?.usd ?? 0) + scoutUsd + (gm?.repairUsd ?? 0),
    cachedShare: done?.usage?.input_tokens ? cached / done.usage.input_tokens : 0,
    estimated: !!done?.estimated,
    tags,
    malformed,
    linted: done?.lint?.length ?? 0,
    skipped,
    skippedTotal: Object.values(skipped).reduce((a, b) => a + b, 0),
    skippedDeps: deps,
    skipDefect: Object.values(skipped).reduce((a, b) => a + b, 0) + malformed > 2 || deps > 0,
    elements: drawn.filter((t) => !LAYOUT.has(kindOf(t))).length,
    maxNewPerSentence: maxNew,
    floatingPoints: floatingPoints(r.registry),
    onLineErrors: r.onLineErrors ?? 0,
    labelHits: labels.hits,
    labelsClipped: labels.clipped,
    outOfFrame: r.outOfFrame,
    words: r.words.length,
    longestSentence: Math.max(0, ...r.sentences.map((s) => wordCount(s.text))),
    wordsBeforeFirstMark: firstMark == null || !firstDraw ? r.words.length : r.words.filter((w) => w.t < (firstDrawNonLayout(drawn)?.firedAt ?? Infinity)).length,
    leaks: LEAK.reduce((n, re) => n + (narration.match(re)?.length ?? 0), 0),
    takeawayFirst: takeaway,
    planChars: done?.plan?.length ?? 0,
    droppedMessages: r.events.filter((e) => e.t === 'note' && e.message.includes('dropped extra message')).length,
    ...(gm ? { gate: gm } : {}),
  };
}

function firstDrawNonLayout(drawn: SerialTiming[]): SerialTiming | undefined {
  return drawn.filter((t) => !LAYOUT.has(kindOf(t))).sort((a, b) => (a.firedAt ?? 0) - (b.firedAt ?? 0))[0];
}

// ---- run level -----------------------------------------------------------------------------

/** Nearest-rank percentile of the non-null values; null if none. */
export function percentile(xs: (number | null)[], p: number): number | null {
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.max(0, Math.ceil(p * v.length) - 1)];
}

export type RunMetrics = {
  n: number;
  ttftMs: { p50: number | null; p90: number | null };
  firstWordMs: { p50: number | null; p90: number | null };
  firstMarkMs: { p50: number | null; p90: number | null };
  totalMs: { p50: number | null; p90: number | null };
  spokenMs: { p50: number | null; p90: number | null };
  /** Mean spoken length (ms). */
  meanSpokenMs: number | null;
  /** Everything the answers cost (scout + stage 2). */
  answerUsd: number;
  usd: number; meanUsd: number; cachedShare: number;
  takeawayFirstRate: number;
  /** Answers with a skip defect (see Metrics.skipDefect). */
  skipDefects: number;
  sum: Record<'tags' | 'malformed' | 'linted' | 'skippedTotal' | 'elements' | 'floatingPoints' | 'onLineErrors' | 'labelHits' | 'labelsClipped' | 'outOfFrame' | 'leaks' | 'droppedMessages', number>;
  mean: Record<'words' | 'longestSentence' | 'wordsBeforeFirstMark' | 'maxNewPerSentence' | 'planChars', number>;
  skipped: Record<string, number>;
  /** Over the gated answers (absent when none was gated). */
  gate?: RunGate;
};

export type RunGate = {
  answers: number;
  sum: Record<'units' | 'fails' | 'strips' | 'drops' | 'droppedWords' | 'repairs' | 'repairOk' | 'repairLate' | 'repairFail' | 'repairRefused' | 'holds' | 'liveSkipAfterPass' | 'shadowDrift' | 'cascades', number>;
  repairUsd: number;
  repairMs: { p50: number | null; p95: number | null };
  shadowMs: { p95: number | null };
  seamMs: { p50: number | null };
  /** Drops per gated unit. */
  dropRate: number;
};

export function aggregateGate(ms: Metrics[]): RunGate | undefined {
  const g = ms.map((m) => m.gate).filter((x): x is GateMetrics => !!x);
  if (!g.length) return undefined;
  const keys = ['units', 'fails', 'strips', 'drops', 'droppedWords', 'repairs', 'repairOk', 'repairLate', 'repairFail', 'repairRefused', 'holds', 'liveSkipAfterPass', 'shadowDrift', 'cascades'] as const;
  const sum = Object.fromEntries(keys.map((k) => [k, g.reduce((s, x) => s + x[k], 0)])) as RunGate['sum'];
  return {
    answers: g.length, sum,
    repairUsd: g.reduce((s, x) => s + x.repairUsd, 0),
    repairMs: { p50: percentile(g.flatMap((x) => x.repairMs), 0.5), p95: percentile(g.flatMap((x) => x.repairMs), 0.95) },
    shadowMs: { p95: percentile(g.flatMap((x) => x.shadowMs), 0.95) },
    seamMs: { p50: percentile(g.map((x) => x.seamMs), 0.5) },
    dropRate: sum.units ? sum.drops / sum.units : 0,
  };
}

export function aggregate(ms: Metrics[]): RunMetrics {
  const n = ms.length;
  const sum = (k: keyof Metrics) => ms.reduce((a, m) => a + (m[k] as number), 0);
  const mean = (k: keyof Metrics) => (n ? sum(k) / n : 0);
  const pp = (k: 'ttftMs' | 'firstWordMs' | 'firstMarkMs' | 'totalMs' | 'spokenMs') => ({ p50: percentile(ms.map((m) => m[k]), 0.5), p90: percentile(ms.map((m) => m[k]), 0.9) });
  const skipped: Record<string, number> = {};
  for (const m of ms) for (const [k, v] of Object.entries(m.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
  return {
    n,
    ttftMs: pp('ttftMs'), firstWordMs: pp('firstWordMs'), firstMarkMs: pp('firstMarkMs'), totalMs: pp('totalMs'),
    spokenMs: pp('spokenMs'),
    meanSpokenMs: (() => { const v = ms.map((m) => m.spokenMs).filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; })(),
    answerUsd: ms.reduce((a, m) => a + (m.answerUsd ?? m.usd), 0),
    usd: sum('usd'), meanUsd: mean('usd'), cachedShare: mean('cachedShare'),
    takeawayFirstRate: n ? ms.filter((m) => m.takeawayFirst).length / n : 0,
    skipDefects: ms.filter((m) => m.skipDefect).length,
    sum: {
      tags: sum('tags'), malformed: sum('malformed'), linted: sum('linted'), skippedTotal: sum('skippedTotal'), elements: sum('elements'),
      floatingPoints: sum('floatingPoints'), onLineErrors: sum('onLineErrors'), labelHits: sum('labelHits'), labelsClipped: sum('labelsClipped'),
      outOfFrame: sum('outOfFrame'), leaks: sum('leaks'), droppedMessages: sum('droppedMessages'),
    },
    mean: { words: mean('words'), longestSentence: mean('longestSentence'), wordsBeforeFirstMark: mean('wordsBeforeFirstMark'), maxNewPerSentence: mean('maxNewPerSentence'), planChars: mean('planChars') },
    skipped,
    ...(aggregateGate(ms) ? { gate: aggregateGate(ms) } : {}),
  };
}
