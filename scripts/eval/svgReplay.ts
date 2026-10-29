// scripts/eval/svgReplay.ts — $0: the svgboard experiment's recorded answers as streamed svg beats.
//
//   node --experimental-strip-types scripts/eval/svgReplay.ts convert <runId…>   → <runId>-beats run dirs (replayable)
//   node --experimental-strip-types scripts/eval/svgReplay.ts measure <runId…>   → silence after the opener, first ink
//
// convert: each run's X1/result.json keeps its opener chunks (and their times) as recorded; stage 2 is
// rewritten in the beat format (src/svgboard/convert.ts: the recorded SVG's groups follow the sentences
// that showed them, a plan of PLAN_CHARS in front), passed through the server's filter
// (server/svgBeats.ts) and re-timed at the answer's own measured output rate (its narration's chars
// per ms), starting when the recorded answer's first output token must have come (the {{svgboard}}
// chunk's time minus the SVG's length at that rate). Then: npm run eval -- --ask "<deck>:<page>:<q>"
// --replay <runId>-beats --no-judge (gate live, recorded repairs: none).
// measure: from a replay's result.json, the longest silence between words after the opener's last
// word, the gap from the opener's end to the next word and to the first svg group's ink.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SvgBeatFilter } from '../../server/svgBeats.ts';
import { toBeats } from '../../src/svgboard/convert.ts';

const RUNS = join(import.meta.dirname, '../../.petu/eval/runs');
/** A real plan (thinking + BOARD layout + regions + groups) runs ~300–500 characters: assume the long end. */
export const PLAN_CHARS = 450;
const CHUNK = 18;

type Chunk = { t: number; d: string };
type Ev = { t: string; [k: string]: unknown };

function convert(id: string): string {
  const dir = join(RUNS, id);
  const r = JSON.parse(readFileSync(join(dir, 'X1/result.json'), 'utf8'));
  const turn = r.turns[0];
  const chunks: Chunk[] = turn.chunks;
  const i = chunks.findIndex((c) => c.d.includes('{{svgboard}}'));
  const svg = (turn.events as Ev[]).find((e) => e.t === 'svg')?.d as string;
  if (i < 0 || !svg) throw new Error(`${id}: not an svgboard recording`);
  const narration = chunks.slice(i).map((c) => c.d).join('');
  const rate = narration.length / Math.max(1, chunks[chunks.length - 1].t - chunks[i].t); // chars per ms
  const t0 = chunks[i].t - svg.length / rate; // the recorded answer's first output token
  let raw = toBeats(svg, narration);
  // A plan as long as a real one.
  raw = raw.replace('Converted from a whole-board answer.', (m) => m + ' ' + 'x'.repeat(Math.max(0, PLAN_CHARS - raw.indexOf('</plan>'))));
  const f = new SvgBeatFilter(() => 0);
  // The opener as recorded; its trailing seam (a lone space sent with stage 2's first text) moves to stage 2's start.
  const out: Chunk[] = chunks.slice(0, i).map((c) => ({ ...c, t: Math.min(c.t, t0) }));
  for (let k = 0; k < raw.length; k += CHUNK) {
    const d = f.push(raw.slice(k, k + CHUNK));
    if (d) out.push({ t: Math.round((t0 + (k + CHUNK) / rate) * 10) / 10, d });
  }
  const tail = f.end();
  if (tail) out.push({ t: Math.round((t0 + raw.length / rate) * 10) / 10, d: tail });
  const s2 = out[i]?.t ?? t0;
  const events = (turn.events as Ev[]).filter((e) => e.t !== 'svg' && !(e.t === 'gate' || e.t === 'repair')).map((e) => (e.t === 'handoff' ? { ...e, ms: Math.round(s2) } : e));
  const nd = join(RUNS, `${id}-beats`);
  mkdirSync(join(nd, 'X1'), { recursive: true });
  writeFileSync(join(nd, 'X1/result.json'), JSON.stringify({ ...r, turns: [{ question: turn.question, chunks: out, events }] }, null, 1));
  const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
  writeFileSync(join(nd, 'run.json'), JSON.stringify({ ...run, convertedFrom: id, planChars: PLAN_CHARS, rateCharsPerMs: rate }, null, 1));
  const ask = run.args.ask;
  console.log(`${nd}\n  rate ${(rate * 1000).toFixed(0)} chars/s, first token ${Math.round(t0)} ms, first board text ${Math.round(s2)} ms (was ${Math.round(chunks[i].t)})\n  replay: npm run eval -- --ask ${JSON.stringify(`${ask.deck}:${ask.page}:${ask.question}`)} --replay ${id}-beats --no-judge`);
  return nd;
}

function measure(id: string): void {
  const f = join(RUNS, id, 'X1/result.json');
  if (!existsSync(f)) { console.log(`${id}: no result`); return; }
  const turn = JSON.parse(readFileSync(f, 'utf8')).turns[0];
  const words: { text: string; t: number }[] = turn.words ?? [];
  const ho = (turn.events as Ev[]).find((e) => e.t === 'handoff') as { openerEndMs?: number; ms?: number } | undefined;
  const openerEnd = ho?.openerEndMs ?? NaN;
  // The opener's last word: the last word starting before the opener ended.
  const k = words.findIndex((w) => w.t > openerEnd - 1);
  const after = k < 0 ? [] : words.slice(Math.max(0, k - 1));
  let maxGap = 0, at = NaN;
  for (let j = 1; j < after.length; j++) { const g = after[j].t - after[j - 1].t; if (g > maxGap) { maxGap = g; at = after[j - 1].t; } }
  const timings = (turn.timings ?? []) as { action: { kind: string; id?: string }; startedAt: number; skipped?: string }[];
  const svgs = timings.filter((x) => x.action.kind === 'svg');
  const firstInk = svgs.find((x) => !x.skipped)?.startedAt ?? NaN;
  const t0 = turn.t0 ?? 0;
  const nextWord = k >= 0 ? words[k].t : NaN;
  const gates = (turn.events as Ev[]).filter((e) => e.t === 'gate');
  const drops = gates.filter((e) => e.action === 'drop').length;
  console.log(`${id}: opener ends ${Math.round(openerEnd)} ms; next word +${Math.round(nextWord - openerEnd)} ms; first svg ink ${Math.round(firstInk - t0)} ms (+${Math.round(firstInk - t0 - openerEnd)} after the opener); longest word gap after the opener ${Math.round(maxGap)} ms at ${Math.round(at)}; groups ${svgs.length} (skipped ${svgs.filter((x) => x.skipped).length}); gate units ${gates.length}, drops ${drops}`);
}

const [cmd, ...ids] = process.argv.slice(2);
if (cmd === 'convert') ids.forEach(convert);
else if (cmd === 'measure') ids.forEach(measure);
else console.log('usage: svgReplay.ts convert|measure <runId…>');
