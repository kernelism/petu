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

  it('skips malformed tags and unterminated tags at end', () => {
    expect(summary(runChunks(['a {{wiggle p=1}} b {{circle p=1']))).toEqual(['a', 'b', '|end']);
  });
});
