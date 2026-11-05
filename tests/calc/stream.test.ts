import { describe, expect, it } from 'vitest';
import { computedTag, pickNumber, readComputed, withCalcs } from '../../src/calc/stream';
import { CalcError, type CalcResult } from '../../src/calc/prepare';
import { ScriptParser } from '../../src/script/parser';

async function* chunks(...parts: string[]) { for (const p of parts) yield p; }
const collect = async (src: AsyncIterable<string>) => { let s = ''; for await (const c of src) s += c; return s; };
/** A stand-in runner: the sandbox needs a browser worker (its own tests run the same lockdown in node:vm). */
const fake = async (id: string, code: string): Promise<CalcResult> => {
  if (code.includes('boom')) throw new CalcError(`calc ${id}: boom`);
  return { id, values: { I4: 0.078125, out: [10, 40, 40], P: [[1, 2], [3, 4]], best: { sum: 3 }, label: 'x' } };
};

describe('calc in the stream', () => {
  it('replaces a calc split across chunks with the numbers it computed', async () => {
    const out = await collect(withCalcs(chunks('Four slices give {{val rod.I4}}. <ca', 'lc id="rod"> export const I4 = 1; </c', 'alc> Then more.'), fake));
    expect(out).toBe('Four slices give {{val rod.I4}}.  {{computed id=rod I4=0.078125 out=10,40,40 P=1,2;3,4 best.sum=3}}  Then more.');
  });

  it('a failed calc leaves a failed tag, never numbers', async () => {
    const out = await collect(withCalcs(chunks('a <calc id="x">boom</calc> b'), fake));
    expect(out).toContain('{{computed id=x failed="calc x: boom"}}');
  });

  it('text with a "<" that is no calc passes through', async () => {
    expect(await collect(withCalcs(chunks('x <', ' 3 and <c', 'ircle'), fake))).toBe('x < 3 and <circle');
  });

  it('reads the tag back and picks numbers by path, case aside', () => {
    const tag = computedTag({ id: 'box', values: { out: [10, 40.5, -3e-7], P: [[1, 2], [3, 4]], n: 5 } });
    const c = readComputed(tag.slice(2, -2))!;
    expect(c.values).toEqual({ out: [10, 40.5, -3e-7], P: [[1, 2], [3, 4]], n: 5 });
    expect(pickNumber(c.values, 'out[1]')).toBe(40.5);
    expect(pickNumber(c.values, 'p[1][0]')).toBe(3);
    expect(pickNumber(c.values, 'N')).toBe(5);
    expect(pickNumber(c.values, 'out[9]')).toBeUndefined();
    expect(pickNumber(c.values, 'out')).toBeUndefined();
  });

  it('the narration says a calc number; an unknown one stays unbound', () => {
    const p = new ScriptParser();
    const ev = [...p.push('{{computed id=rod I4=0.078125 out=10,40,40}} With four slices it is {{val rod.I4}}, then {{val rod.out[1]}} and {{val rod.nope}}.'), ...p.end()];
    const words = ev.flatMap((e) => (e.type === 'word' ? [e.text] : []));
    expect(words.join(' ')).toMatch(/it is 0\.078\d*, then 40 and —\./);
  });
});

describe('calc on the wire', () => {
  it('the server filter sends a calc as one tag the client runs; its code is never narration', async () => {
    const { SvgBeatFilter } = await import('../../server/svgBeats');
    const f = new SvgBeatFilter(() => 0);
    const code = '\n  const a = [1, 2];\n  // a comment with {braces} & more\n  export const s = a.reduce((x, y) => x + y, 0);\n';
    const wire = f.push(`Sum it. <calc id="t">${code}</calc> It is {{val t.s}}.`) + f.end();
    expect(wire).toMatch(/\{\{calcsrc id=t [^{}\n]*\}\}/);
    expect(wire.replace(/\{\{[^}]*\}\}/g, '')).not.toContain('reduce');
    let seen = '';
    const out = await collect(withCalcs(chunks(wire), async (id, c) => { seen = c; return { id, values: { s: 3 } }; }));
    expect(seen).toBe(code);
    expect(out).toContain('{{computed id=t s=3}}');
  });
});
