// scripts/gate-beats/answerReplay.ts — one founder answer from .petu/answers.jsonl through the live gate,
// offline ($0): the recorded stage-2 script, streamed in even chunks over its recorded time, the gate's
// preflight with the deck's real page texts. Prints every unit the gate dropped, stripped or cut, why,
// and the narration that was released.
//   node --import ./scripts/lib/tsResolve.mjs --experimental-transform-types --no-warnings scripts/gate-beats/answerReplay.ts <at-stamp> [--deck <pdf>] [--opener "…"]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayGate } from './liveReplay.ts';
import type { Recording } from './recordings.ts';
import type { GateEvent } from '../../src/gate/events.ts';

// The svg checks parse groups with the DOM, as the browser does.
const { JSDOM } = (await import('jsdom' as string)) as { JSDOM: new (html: string) => { window: Record<string, unknown> } };
const dom = new JSDOM('');
Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer, Node: dom.window.Node, Element: dom.window.Element });
const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const at = argv[0];
const root = opt('--root') ?? process.cwd();
const line = readFileSync(join(root, '.petu/answers.jsonl'), 'utf8').split('\n').find((l) => l.includes(`"at":"${at}"`));
if (!line) { console.error(`no answer at ${at}`); process.exit(1); }
const a = JSON.parse(line);
const deck = opt('--deck');
const opener = opt('--opener') ?? '';
const script: string = a.script;
const total = a.svg?.totalMs ?? 20000, ttft = a.svg?.ttftMs ?? 1000;
const pieces = script.match(/[\s\S]{1,40}/g) ?? [];
const chunks = [...(opener ? [{ t: 0, d: opener }] : []), ...pieces.map((d, i) => ({ t: ttft + (i * (total - ttft)) / pieces.length, d }))];
const rec: Recording = {
  run: 'answers', q: at, dir: root, question: a.question, page: a.page, src: deck ? `/api/dev-pdf/${deck}` : undefined,
  script: opener + script, stage2At: opener.length, chunks, stage2Chunk: opener ? 1 : 0, words: [], timings: [], registry: [],
};
const { grounder } = await import('./run.ts');
const g = await grounder();
const { text } = await g.pages(rec);
const r = await replayGate(rec, { pages: text });
await g.close();
const gates = r.events.filter((e): e is GateEvent => e.t === 'gate');
for (const e of gates) {
  if (e.action === 'release' && e.result === 'pass') continue;
  console.log(`${e.action.toUpperCase()} ${e.k} (${e.unit}) [${e.flags.map((f) => `${f.check}: ${f.detail}`).join(' | ')}] ${e.notes.join('; ')}\n    "${(e.text ?? '').slice(0, 300)}"`);
}
console.log('\nRELEASED:\n' + r.released.map((x) => x.text).join(''));
console.log('\nstats', JSON.stringify(r.stats));
