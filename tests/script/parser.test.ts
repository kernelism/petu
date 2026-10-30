import { describe, it, expect } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import type { ScriptEvent } from '../../src/script/types';

const SCRIPT = 'Take this {{circle p=3 at=290,473 r=21}} point x in the left image. Then {{highlight p=3 "a ray in 3D"}}look here.';

function runChunks(chunks: string[]): ScriptEvent[] {
  const p = new ScriptParser();
  const out: ScriptEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.end());
  return out;
}
const summary = (ev: ScriptEvent[]) => ev.map((e) => (e.type === 'word' ? e.text : e.type === 'action' ? `<${e.action.kind}>` : '|end'));

describe('ScriptParser', () => {
  const expected = ['Take', 'this', '<circle>', 'point', 'x', 'in', 'the', 'left', 'image.', 'Then', '<highlight>', 'look', 'here.', '|end'];

  it('parses a whole script', () => {
    expect(summary(runChunks([SCRIPT]))).toEqual(expected);
  });

  it('is independent of chunk boundaries (every split point)', () => {
    for (let i = 1; i < SCRIPT.length; i++) {
      expect(summary(runChunks([SCRIPT.slice(0, i), SCRIPT.slice(i)]))).toEqual(expected);
    }
  });

  it('handles 1-char streaming', () => {
    expect(summary(runChunks(SCRIPT.split('')))).toEqual(expected);
  });

  it('does not emit a partial trailing word before end', () => {
    const p = new ScriptParser();
    expect(summary(p.push('Hello wor'))).toEqual(['Hello']);
    expect(summary(p.push('ld '))).toEqual(['world']);
  });

  it('skips malformed tags; a tag the stream cut off is dropped, never spoken', () => {
    expect(summary(runChunks(['a {{wiggle p=1}} b {{circle p=1']))).toEqual(['a', 'b', '|end']);
  });

  it('a cut-off svg group keeps its whole children (closed), else it is dropped', () => {
    const svg = (chunks: string[]) => runChunks(chunks).flatMap((e) => (e.type === 'action' && e.action.kind === 'svg' ? [(e.action as { svg: string }).svg] : []));
    expect(svg(['Here {{svg <g id="r"> <line x1="0" y1="0" x2="5" y2="5"/> <circle cx="4']))
      .toEqual(['<g id="r"> <line x1="0" y1="0" x2="5" y2="5"/></g>']);
    expect(svg(['Here {{svg <g id="r"> <text x="1">Hel'])).toEqual([]);
    expect(summary(runChunks(['Here {{svg <g id="r"> <text x="1">Hel']))).toEqual(['Here', '|end']);
  });

  it('an unterminated tag does not swallow the rest of the answer (newline, another tag, 800 chars)', () => {
    expect(summary(runChunks(['a {{circle p=1 b c\nd e {{clear}} f']))).toEqual(['a', '{{circle', 'p=1', 'b', 'c', 'd', 'e', '<clear>', 'f', '|end']);
    expect(summary(runChunks(['a {{circle p=1 b {{clear}} c']))).toEqual(['a', '{{circle', 'p=1', 'b', '<clear>', 'c', '|end']);
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const p = new ScriptParser();
    const out = summary(p.push(`x {{circle p=1 ${long} `));
    expect(out[0]).toBe('x');
    expect(out[1]).toBe('{{circle');
    expect(out.length).toBeGreaterThan(150); // emitted while streaming, not held to the end
  });

  it('a }} inside a quoted string does not close the tag', () => {
    const ev = runChunks(['say {{label p=1 at=10,10 "a}}b"}} done {{label p=1 at=1,1 “c}}d”}} ok']);
    expect(summary(ev)).toEqual(['say', '<label>', 'done', '<label>', 'ok', '|end']);
    const labels = ev.flatMap((e) => (e.type === 'action' && e.action.kind === 'label' ? [e.action.text] : []));
    expect(labels).toEqual(['a}}b', 'c}}d']);
  });

  it('randomized splits of messy input match the whole-input parse', () => {
    const MESSY =
      'Start {{scroll p=2}} here, {{circle p=1 "x}}y" near=10,10}} then {{oops p=1 never closed\n' +
      'next line {{highlight p=1 "a ray"}}and {{box p=1 {{clear}} after { single } braces }} and {{label p=1 at=5,5 “q”}} end {{circle p=1';
    const whole = summary(runChunks([MESSY]));
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let n = 0; n < 300; n++) {
      const chunks: string[] = [];
      for (let i = 0; i < MESSY.length;) { const k = 1 + Math.floor(rand() * 12); chunks.push(MESSY.slice(i, i + k)); i += k; }
      expect(summary(runChunks(chunks))).toEqual(whole);
    }
    expect(whole).toContain('<clear>');
    expect(whole).toContain('<label>');
    expect(whole.at(-2)).toBe('end'); // the cut-off {{circle p=1 at the end is dropped
  });
});

describe('long let tags', () => {
  it('a fitted figure declared in one let of ~450 characters parses', async () => {
    const { ScriptParser } = await import('../../src/script/parser');
    const defs = Array.from({ length: 30 }, (_, i) => `P${i}=${i * 10},${i * 7}`).join(' ');
    const p = new ScriptParser();
    const ev = [...p.push(`Look {{let on=s ${defs}}} here.`), ...p.end()];
    const a = ev.find((e) => e.type === 'action');
    expect(a && a.type === 'action' && a.action.kind === 'let' && a.action.defs.length).toBe(30);
  });
});
