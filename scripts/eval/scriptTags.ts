// scripts/eval/scriptTags.ts — what the app's own parser made of each tag in a recorded answer:
// the action it became (a {{scene}} is a sketch, a {{contrast}} the copy it draws, a {{val}} the
// words it said) or that it was rejected. The judge transcript and the `malformed` metric read this,
// so a working {{const}}/{{find}}/{{val}} is never shown or counted as a failure.
// Imports the app parser, so entry points need `--import ./scripts/lib/tsResolve.mjs --experimental-transform-types`.
import { ScriptParser } from '../../src/script/parser.ts';
import { GateState } from '../../src/gate/engine.ts';
import type { RawAction } from '../../src/script/types.ts';
import type { EvalResult } from '../../src/agent/evalHooks.ts';
import { scanTags } from './judge.ts';

/** One tag of `scanTags(raw)`: rejected (`ok: false`), or the kind it became, with a val's ref and said text and a find's sources. */
export type TagParse = { ok: boolean; kind?: string; ref?: string; said?: string; of?: string[] };
/** `tags` lines up with `scanTags(raw)`; `malformed` = parser rejections + unclosed tags (as replayStress counts them). */
export type ScriptParse = { tags: TagParse[]; malformed: number };

const MALFORMED = '[script] skipped malformed tag';

/** Runs `f` with console.warn captured; returns how many parser rejections it warned. */
function counting<T>(f: () => T): { out: T; rejected: number } {
  const warn = console.warn;
  let rejected = 0;
  console.warn = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith(MALFORMED)) rejected++; };
  try { return { out: f(), rejected }; } finally { console.warn = warn; }
}

export function parseScript(raw: string): ScriptParse {
  // The count: the whole script through one parser, as the app streams it.
  const whole = counting(() => { const p = new ScriptParser(); return [...p.push(raw), ...p.end()]; });
  const unclosed = whole.out.filter((e) => e.type === 'word' && e.text.includes('{{')).length;

  // Per tag: one parser (one value model, in stream order) fed each tag on its own.
  const p = new ScriptParser(new GateState());
  const tags = scanTags(raw).map(({ inner }): TagParse => {
    const got = counting(() => {
      const ev = p.push(`{{${inner}}} `);
      return ev.some((e) => e.type === 'action') ? ev : [...ev, ...p.end()]; // not a tag to the parser: flush its text
    });
    const a = got.out.find((e) => e.type === 'action');
    if (!a || a.type !== 'action') return { ok: false };
    const act = a.action as RawAction;
    if (act.kind === 'val') return { ok: true, kind: 'val', ref: act.ref, ...(act.said != null ? { said: act.said } : {}) };
    if (act.kind === 'find') return { ok: true, kind: 'find', of: [...act.of] };
    return { ok: true, kind: String(act.kind) };
  });
  return { tags, malformed: whole.rejected + unclosed };
}

/** parseScript over a recorded answer's text. */
export const parseAnswer = (r: Pick<EvalResult, 'chunks'>): ScriptParse => parseScript(r.chunks.map((c) => c.d).join(''));
