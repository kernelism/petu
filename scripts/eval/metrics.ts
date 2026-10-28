// scripts/eval/metrics.ts — pure metrics over one recorded answer (`__petu.result()`).
// Geometry comes from the engine's registry and timing log, never from pixels.
import type { EvalResult, RegistryRow, SerialTiming } from '../../src/agent/evalHooks.ts';

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export type Metrics = {
  ttftMs: number | null; firstWordMs: number | null; firstMarkMs: number | null; totalMs: number | null;
  usd: number; cachedShare: number; estimated: boolean;
  tags: number; malformed: number; linted: number; skipped: Record<string, number>; skippedTotal: number;
  elements: number; maxNewPerSentence: number;
  floatingPoints: number; onLineErrors: number;
  labelHits: number; labelsClipped: number; outOfFrame: number;
  words: number; longestSentence: number; wordsBeforeFirstMark: number; leaks: number;
  takeawayFirst: boolean; planChars: number; droppedMessages: number;
};

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

export function computeMetrics(r: EvalResult): Metrics {
  const done = r.events.find((e) => e.t === 'done') as Extract<EvalResult['events'][number], { t: 'done' }> | undefined;
  const text = r.chunks.map((c) => c.d).join('');
  const tags = (text.match(/\{\{/g) ?? []).length;
  // {{let}} only names points: it never becomes a timed action, so it is not a malformed tag.
  const lets = (text.match(/\{\{\s*let\b/g) ?? []).length;
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
  const labels = labelStats(r.registry);

  return {
    ttftMs: r.chunks[0]?.t ?? done?.ttftMs ?? null,
    firstWordMs: r.words[0]?.t ?? null,
    firstMarkMs: firstMark,
    totalMs: ends.length ? Math.max(...ends) : null,
    usd: done?.usd ?? 0,
    cachedShare: done?.usage?.input_tokens ? cached / done.usage.input_tokens : 0,
    estimated: !!done?.estimated,
    tags,
    malformed: Math.max(0, tags - lets - r.timings.length),
    linted: done?.lint?.length ?? 0,
    skipped,
    skippedTotal: Object.values(skipped).reduce((a, b) => a + b, 0),
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
  usd: number; meanUsd: number; cachedShare: number;
  takeawayFirstRate: number;
  sum: Record<'tags' | 'malformed' | 'linted' | 'skippedTotal' | 'elements' | 'floatingPoints' | 'onLineErrors' | 'labelHits' | 'labelsClipped' | 'outOfFrame' | 'leaks' | 'droppedMessages', number>;
  mean: Record<'words' | 'longestSentence' | 'wordsBeforeFirstMark' | 'maxNewPerSentence' | 'planChars', number>;
  skipped: Record<string, number>;
};

export function aggregate(ms: Metrics[]): RunMetrics {
  const n = ms.length;
  const sum = (k: keyof Metrics) => ms.reduce((a, m) => a + (m[k] as number), 0);
  const mean = (k: keyof Metrics) => (n ? sum(k) / n : 0);
  const pp = (k: 'ttftMs' | 'firstWordMs' | 'firstMarkMs' | 'totalMs') => ({ p50: percentile(ms.map((m) => m[k]), 0.5), p90: percentile(ms.map((m) => m[k]), 0.9) });
  const skipped: Record<string, number> = {};
  for (const m of ms) for (const [k, v] of Object.entries(m.skipped)) skipped[k] = (skipped[k] ?? 0) + v;
  return {
    n,
    ttftMs: pp('ttftMs'), firstWordMs: pp('firstWordMs'), firstMarkMs: pp('firstMarkMs'), totalMs: pp('totalMs'),
    usd: sum('usd'), meanUsd: mean('usd'), cachedShare: mean('cachedShare'),
    takeawayFirstRate: n ? ms.filter((m) => m.takeawayFirst).length / n : 0,
    sum: {
      tags: sum('tags'), malformed: sum('malformed'), linted: sum('linted'), skippedTotal: sum('skippedTotal'), elements: sum('elements'),
      floatingPoints: sum('floatingPoints'), onLineErrors: sum('onLineErrors'), labelHits: sum('labelHits'), labelsClipped: sum('labelsClipped'),
      outOfFrame: sum('outOfFrame'), leaks: sum('leaks'), droppedMessages: sum('droppedMessages'),
    },
    mean: { words: mean('words'), longestSentence: mean('longestSentence'), wordsBeforeFirstMark: mean('wordsBeforeFirstMark'), maxNewPerSentence: mean('maxNewPerSentence'), planChars: mean('planChars') },
    skipped,
  };
}
