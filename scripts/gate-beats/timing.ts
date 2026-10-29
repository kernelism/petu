// scripts/gate-beats/timing.ts — step 0 of gated beats: how much slack does generation leave?
//   npm run gate-beats-timing [-- --json out.json] [--runs a,b]
// From every live (non-replay) eval recording: stage-2 generation rate after its first token vs the
// playback rate, the lead the stream builds over the playhead, and — for each beat rule — beat sizes,
// whether beat k+1 is generated before beat k starts playing (one-beat look-ahead), the hold a
// whole-beat release adds to the first stage-2 beat, and the repair budget per beat. No API calls.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beats, tokenize, type BeatRule } from '../../src/gate/segment.ts';
import { listRuns, loadRun, runsDir, type Recording } from './recordings.ts';

export const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

/** Generation time of each script offset: the arrival of the chunk that completes it. */
export function genClock(rec: Pick<Recording, 'chunks'>): (offset: number) => number {
  const ends: number[] = [];
  let n = 0;
  for (const c of rec.chunks) { n += c.d.length; ends.push(n); }
  return (off) => { let lo = 0, hi = ends.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (ends[m] >= off) hi = m; else lo = m + 1; } return rec.chunks[lo].t; };
}

export type BeatTiming = { k: number; words: number; tags: number; boardInk: number; playStart: number; playEnd: number; genEnd: number; playS: number };
export type AnswerTiming = {
  label: string; effort?: string;
  s2Words: number; s2Tags: number; s2Chars: number;
  genS: number; genWps: number; genTagsPs: number; genCharsPs: number;
  playWps: number; ratio: number;
  /** Seconds of playback still ahead when the last chunk arrives. */
  bufferAtGenEnd: number;
  /** Lead (play − gen) of the first stage-2 word, the 50th, the 100th, the last. */
  lead: { first: number; w50?: number; w100?: number; last: number };
  ttftMs?: number;
  beats: Partial<Record<BeatRule, BeatTiming[]>>;
};

const RULES: BeatRule[] = ['sentence', 'para', 'ink', 'hybrid'];

export function answerTiming(rec: Recording): AnswerTiming | null {
  const toks = tokenize(rec.script);
  const words = toks.filter((t) => t.kind === 'word');
  if (words.length !== rec.words.length || words.length < 20) return null; // can't align word times
  const gen = genClock(rec);
  const play = (i: number) => rec.words[i].t;
  const s2 = words.filter((w) => w.start >= rec.stage2At);
  if (s2.length < 20) return null;
  const s2Tags = toks.filter((t) => t.kind === 'tag' && t.start >= rec.stage2At).length;
  const t0 = rec.chunks[rec.stage2Chunk]?.t ?? rec.chunks[0].t;
  const tEnd = rec.chunks[rec.chunks.length - 1].t;
  const genS = Math.max(0.001, (tEnd - t0) / 1000);
  const s2Chars = rec.script.length - rec.stage2At;
  const playS = (play(s2[s2.length - 1].i) - play(s2[0].i)) / 1000;
  const playWps = (s2.length - 1) / Math.max(0.001, playS);
  const genWps = s2.length / genS;
  const leadOf = (w: (typeof s2)[number]) => (play(w.i) - gen(w.end)) / 1000;
  const out: AnswerTiming = {
    label: `${rec.run}/${rec.q}`, effort: rec.effort,
    s2Words: s2.length, s2Tags, s2Chars, genS, genWps, genTagsPs: s2Tags / genS, genCharsPs: s2Chars / genS,
    playWps, ratio: genWps / playWps,
    bufferAtGenEnd: (play(words[words.length - 1].i) - tEnd) / 1000,
    lead: { first: leadOf(s2[0]), ...(s2[49] ? { w50: leadOf(s2[49]) } : {}), ...(s2[99] ? { w100: leadOf(s2[99]) } : {}), last: leadOf(s2[s2.length - 1]) },
    ttftMs: rec.ttftMs, beats: {},
  };
  const base = words.findIndex((w) => w.start >= rec.stage2At);
  for (const rule of RULES) {
    const bs = beats(rec.script.slice(rec.stage2At), { rule });
    out.beats[rule] = bs.filter((b) => b.words.length).map((b) => {
      const first = base + b.words[0].i, last = base + b.words[b.words.length - 1].i;
      return {
        k: b.k, words: b.words.length, tags: b.tags.length,
        boardInk: b.tags.filter((t) => t.action && 'region' in t.action && (t.action as { region?: string }).region != null).length,
        playStart: play(first), playEnd: last + 1 < rec.words.length ? play(last + 1) : play(last) + 400,
        genEnd: gen(rec.stage2At + b.end), playS: 0,
      };
    }).map((b) => ({ ...b, playS: (b.playEnd - b.playStart) / 1000 }));
  }
  return out;
}

export type RuleStats = {
  rule: BeatRule; beats: number; wordsP50: number; wordsP90: number; secP50: number; secP90: number;
  /** Fraction of beats k ≥ 1 (stage-2) whose successor was not generated when k started playing. */
  lookaheadMiss: number; lookaheadN: number;
  /** playStart(k) − genEnd(k+1): seconds to spare for the one-beat look-ahead. */
  slackP10: number; slackP50: number;
  /** genEnd(beat 1) − playStart(beat 1), when positive: the hold a whole-beat release adds before stage 2's first beat. */
  firstHoldP50: number; firstHoldP90: number; firstHoldShare: number;
  /** playStart(k) − genEnd(k) for k ≥ 2: time to repair beat k before it is due. */
  repairP10: number; repairP50: number; repairUnder6s: number;
};

export function ruleStats(ts: AnswerTiming[], rule: BeatRule, gateMs = 50): RuleStats {
  const all = ts.flatMap((t) => t.beats[rule] ?? []);
  const slack: number[] = [], firstHold: number[] = [], repair: number[] = [];
  for (const t of ts) {
    const bs = t.beats[rule] ?? [];
    if (bs[0]) firstHold.push(Math.max(0, (bs[0].genEnd + gateMs - bs[0].playStart) / 1000));
    for (let k = 0; k + 1 < bs.length; k++) slack.push((bs[k].playStart - bs[k + 1].genEnd - gateMs) / 1000);
    for (let k = 1; k < bs.length; k++) repair.push((bs[k].playStart - bs[k].genEnd - gateMs) / 1000);
  }
  return {
    rule, beats: all.length,
    wordsP50: pct(all.map((b) => b.words), 0.5), wordsP90: pct(all.map((b) => b.words), 0.9),
    secP50: pct(all.map((b) => b.playS), 0.5), secP90: pct(all.map((b) => b.playS), 0.9),
    lookaheadMiss: slack.filter((s) => s < 0).length / Math.max(1, slack.length), lookaheadN: slack.length,
    slackP10: pct(slack, 0.1), slackP50: pct(slack, 0.5),
    firstHoldP50: pct(firstHold, 0.5), firstHoldP90: pct(firstHold, 0.9), firstHoldShare: firstHold.filter((h) => h > 0).length / Math.max(1, firstHold.length),
    repairP10: pct(repair, 0.1), repairP50: pct(repair, 0.5), repairUnder6s: repair.filter((r) => r < 6).length / Math.max(1, repair.length),
  };
}

/** Live recordings only: not replays (their chunk times are re-played), one per distinct script. */
export function liveRecordings(root = runsDir(), only?: string[]): Recording[] {
  const seen = new Set<string>();
  const out: Recording[] = [];
  for (const run of only ?? listRuns(root)) {
    if (/replay|fake|stub/.test(run)) continue;
    const rj = join(root, run, 'run.json');
    if (existsSync(rj)) { try { if (JSON.parse(readFileSync(rj, 'utf8')).replayOf) continue; } catch { /* keep */ } }
    let recs: Recording[] = [];
    try { recs = loadRun(run, root); } catch { continue; }
    for (const r of recs) {
      const h = createHash('sha1').update(r.script).digest('hex');
      if (seen.has(h)) continue;
      seen.add(h); out.push(r);
    }
  }
  return out;
}

const f = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

export function formatTiming(ts: AnswerTiming[]): string {
  const q = (xs: number[], d = 1) => `p50 ${f(pct(xs, 0.5), d)} · p90 ${f(pct(xs, 0.9), d)} · p10 ${f(pct(xs, 0.1), d)}`;
  const lines = [
    `step 0: ${ts.length} live stage-2 answers with aligned word times`,
    `stage-2 generation after first token: words/s ${q(ts.map((t) => t.genWps))}; tags/s ${q(ts.map((t) => t.genTagsPs))}; chars/s ${q(ts.map((t) => t.genCharsPs), 0)}`,
    `stage-2 generation time (s): ${q(ts.map((t) => t.genS))}; stage-2 TTFT (ms): ${q(ts.filter((t) => t.ttftMs != null).map((t) => t.ttftMs!), 0)}`,
    `playback words/s (recorded, syllable-paced at 170 wpm): ${q(ts.map((t) => t.playWps), 2)}`,
    `generation ÷ playback speed: ${q(ts.map((t) => t.ratio))}; answers under 5×: ${ts.filter((t) => t.ratio < 5).length}/${ts.length}`,
    `lead of the stream over the playhead (s): first stage-2 word ${q(ts.map((t) => t.lead.first))}; word 50 ${q(ts.filter((t) => t.lead.w50 != null).map((t) => t.lead.w50!))}; word 100 ${q(ts.filter((t) => t.lead.w100 != null).map((t) => t.lead.w100!))}; last word ${q(ts.map((t) => t.lead.last))}`,
    `playback still buffered when the last chunk arrives (s): ${q(ts.map((t) => t.bufferAtGenEnd))}`,
    '',
    'rule       beats  words p50/p90  secs p50/p90  look-ahead miss  slack p10/p50 (s)  hold before beat 1 p50/p90 (share>0)  repair budget p10/p50 (<6s share)',
  ];
  for (const r of RULES) {
    const s = ruleStats(ts, r);
    lines.push(`${r.padEnd(9)} ${String(s.beats).padStart(6)}  ${f(s.wordsP50, 0).padStart(5)}/${f(s.wordsP90, 0).padEnd(5)}    ${f(s.secP50).padStart(5)}/${f(s.secP90).padEnd(5)}   ${(100 * s.lookaheadMiss).toFixed(1).padStart(5)}% of ${s.lookaheadN}     ${f(s.slackP10)}/${f(s.slackP50)}            ${f(s.firstHoldP50)}/${f(s.firstHoldP90)} (${(100 * s.firstHoldShare).toFixed(0)}%)                    ${f(s.repairP10)}/${f(s.repairP50)} (${(100 * s.repairUnder6s).toFixed(0)}%)`);
  }
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const recs = liveRecordings(runsDir(), opt('--runs')?.split(','));
  const ts = recs.map(answerTiming).filter((x): x is AnswerTiming => x != null);
  console.log(`recordings: ${recs.length} live distinct; aligned: ${ts.length}`);
  console.log(formatTiming(ts));
  const byEffort = new Map<string, AnswerTiming[]>();
  for (const t of ts) byEffort.set(t.effort ?? '?', [...(byEffort.get(t.effort ?? '?') ?? []), t]);
  for (const [e, xs] of byEffort) console.log(`effort ${e}: n=${xs.length}, gen words/s p50 ${f(pct(xs.map((t) => t.genWps), 0.5))}, ratio p50 ${f(pct(xs.map((t) => t.ratio), 0.5))}, hybrid look-ahead miss ${(100 * ruleStats(xs, 'hybrid').lookaheadMiss).toFixed(1)}%`);
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify(ts, null, 1));
}
