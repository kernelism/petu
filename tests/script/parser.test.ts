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

  it('skips malformed tags; an unterminated tag at the end comes out as words', () => {
    expect(summary(runChunks(['a {{wiggle p=1}} b {{circle p=1']))).toEqual(['a', 'b', '{{circle', 'p=1', '|end']);
  });

  it('an unterminated tag does not swallow the rest of the answer (newline, another tag, 300 chars)', () => {
    expect(summary(runChunks(['a {{circle p=1 b c\nd e {{clear}} f']))).toEqual(['a', '{{circle', 'p=1', 'b', 'c', 'd', 'e', '<clear>', 'f', '|end']);
    expect(summary(runChunks(['a {{circle p=1 b {{clear}} c']))).toEqual(['a', '{{circle', 'p=1', 'b', '<clear>', 'c', '|end']);
    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
    const p = new ScriptParser();
    const out = summary(p.push(`x {{circle p=1 ${long} `));
    expect(out[0]).toBe('x');
    expect(out[1]).toBe('{{circle');
    expect(out.length).toBeGreaterThan(60); // emitted while streaming, not held to the end
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
    expect(whole.at(-2)).toBe('p=1');
  });
});
